import { join } from "@std/path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import type {
  CodeSource,
  CodeSourceProvider,
  GitTypeSettings,
  ProviderCapabilities,
  SyncResult,
  TypeSettings,
} from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import { GitOperationError } from "./errors.ts";

export interface GitCodeSourceProviderOptions {
  /** Base code directory (e.g., "./code") */
  codeDirectory: string;
  /** Encryption service for sensitive fields (authToken) */
  encryptionService: IEncryptionService;
}

interface TargetRef {
  type: "branch" | "tag" | "commit";
  value: string;
}

/**
 * Deno file system adapter for isomorphic-git.
 * Maps isomorphic-git's expected fs interface to Deno's file system APIs.
 */
const denoFs = {
  promises: {
    async readFile(
      path: string,
      options?: { encoding?: string },
    ): Promise<Uint8Array | string> {
      const data = await Deno.readFile(path);
      if (options?.encoding === "utf8") {
        return new TextDecoder().decode(data);
      }
      return data;
    },

    async writeFile(
      path: string,
      data: Uint8Array | string,
      options?: { mode?: number },
    ): Promise<void> {
      const bytes = typeof data === "string"
        ? new TextEncoder().encode(data)
        : data;
      await Deno.writeFile(path, bytes, { mode: options?.mode });
    },

    async unlink(path: string): Promise<void> {
      await Deno.remove(path);
    },

    async readdir(path: string): Promise<string[]> {
      const entries: string[] = [];
      for await (const entry of Deno.readDir(path)) {
        entries.push(entry.name);
      }
      return entries;
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await Deno.mkdir(path, { recursive: options?.recursive ?? false });
    },

    async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await Deno.remove(path, { recursive: options?.recursive ?? false });
    },

    async stat(
      path: string,
    ): Promise<{
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
      size: number;
      mtimeMs: number;
      ctimeMs: number;
      mode: number;
    }> {
      const stat = await Deno.stat(path);
      return {
        isFile: () => stat.isFile,
        isDirectory: () => stat.isDirectory,
        isSymbolicLink: () => stat.isSymlink,
        size: stat.size,
        mtimeMs: stat.mtime?.getTime() ?? 0,
        ctimeMs: stat.ctime?.getTime() ?? stat.mtime?.getTime() ?? 0,
        mode: stat.mode ?? 0o644,
      };
    },

    async lstat(
      path: string,
    ): Promise<{
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
      size: number;
      mtimeMs: number;
      ctimeMs: number;
      mode: number;
    }> {
      const stat = await Deno.lstat(path);
      return {
        isFile: () => stat.isFile,
        isDirectory: () => stat.isDirectory,
        isSymbolicLink: () => stat.isSymlink,
        size: stat.size,
        mtimeMs: stat.mtime?.getTime() ?? 0,
        ctimeMs: stat.ctime?.getTime() ?? stat.mtime?.getTime() ?? 0,
        mode: stat.mode ?? 0o644,
      };
    },

    async readlink(path: string): Promise<string> {
      return await Deno.readLink(path);
    },

    async symlink(target: string, path: string): Promise<void> {
      await Deno.symlink(target, path);
    },

    async chmod(path: string, mode: number): Promise<void> {
      // Deno.chmod is not available on all platforms
      try {
        await Deno.chmod(path, mode);
      } catch {
        // Ignore chmod errors (e.g., on Windows)
      }
    },
  },
};

/**
 * Provider for git-based code sources.
 *
 * Git sources sync files from a remote git repository. The local directory
 * is managed by git and should not be modified directly.
 *
 * Capabilities:
 * - isSyncable: true (can sync from remote git repo)
 * - isEditable: false (files come from git, not editable via API)
 *
 * Uses isomorphic-git (pure JavaScript) for all git operations - no external
 * git binary required.
 */
export class GitCodeSourceProvider implements CodeSourceProvider {
  readonly type = "git" as const;
  private readonly codeDirectory: string;
  private readonly encryptionService: IEncryptionService;

  constructor(options: GitCodeSourceProviderOptions) {
    this.codeDirectory = options.codeDirectory;
    this.encryptionService = options.encryptionService;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      isSyncable: true, // Can sync from remote git repo
      isEditable: false, // Files managed by git, not editable via API
    };
  }

  // ===========================================================================
  // Encryption methods for sensitive fields
  // ===========================================================================

  /**
   * Encrypt sensitive fields (authToken) before database storage.
   */
  async encryptSensitiveFields(settings: TypeSettings): Promise<TypeSettings> {
    const gitSettings = settings as GitTypeSettings;
    if (!gitSettings.authToken) {
      return settings;
    }
    return {
      ...gitSettings,
      authToken: await this.encryptionService.encrypt(gitSettings.authToken),
    };
  }

  /**
   * Decrypt sensitive fields (authToken) after database retrieval.
   */
  async decryptSensitiveFields(settings: TypeSettings): Promise<TypeSettings> {
    const gitSettings = settings as GitTypeSettings;
    if (!gitSettings.authToken) {
      return settings;
    }
    return {
      ...gitSettings,
      authToken: await this.encryptionService.decrypt(gitSettings.authToken),
    };
  }

  /**
   * Sync the git repository.
   *
   * - If not cloned: performs initial clone
   * - If URL changed: deletes directory and re-clones
   * - Otherwise: fetches and resets to target ref
   */
  async sync(
    source: CodeSource,
    token: CancellationToken,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const dirPath = join(this.codeDirectory, source.name);
    // typeSettings already decrypted by CodeSourceService.rowToSource()
    const settings = source.typeSettings as GitTypeSettings;

    try {
      token.throwIfCancelled();

      const isCloned = await this.isCloned(dirPath);

      // Check if we need to reclone (URL changed)
      if (isCloned && (await this.needsReclone(settings, dirPath))) {
        // Delete and re-clone
        await this.deleteDirectoryContents(dirPath);
        return await this.performClone(settings, dirPath, token, startTime);
      }

      if (!isCloned) {
        // Initial clone
        return await this.performClone(settings, dirPath, token, startTime);
      }

      // Fetch and reset to target ref
      return await this.performFetchAndReset(
        settings,
        dirPath,
        token,
        startTime,
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error instanceof GitOperationError) {
        return {
          success: false,
          error: error.message,
          durationMs,
        };
      }

      if (error instanceof Error) {
        return {
          success: false,
          error: error.message,
          durationMs,
        };
      }

      return {
        success: false,
        error: String(error),
        durationMs,
      };
    }
  }

  /**
   * Ensure the source directory exists.
   */
  async ensureDirectory(sourceName: string): Promise<void> {
    const dirPath = join(this.codeDirectory, sourceName);
    await Deno.mkdir(dirPath, { recursive: true });
  }

  /**
   * Delete the source directory and all contents.
   * Silently succeeds if directory doesn't exist.
   */
  async deleteDirectory(sourceName: string): Promise<void> {
    const dirPath = join(this.codeDirectory, sourceName);
    try {
      await Deno.remove(dirPath, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  /**
   * Check if the source directory exists.
   */
  async directoryExists(sourceName: string): Promise<boolean> {
    const dirPath = join(this.codeDirectory, sourceName);
    try {
      const stat = await Deno.stat(dirPath);
      return stat.isDirectory;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  // ===========================================================================
  // Private helper methods
  // ===========================================================================

  /**
   * Create auth callback for isomorphic-git.
   * Returns username/password for HTTPS auth.
   */
  private createAuthCallback(
    authToken?: string,
  ): () => { username: string; password: string } {
    return () => ({
      username: authToken ?? "",
      password: authToken ? "x-oauth-basic" : "",
    });
  }

  /**
   * Determine the target ref from settings.
   * Priority: commit > tag > branch (default: main)
   */
  private getTargetRef(settings: GitTypeSettings): TargetRef {
    if (settings.commit) {
      return { type: "commit", value: settings.commit };
    }
    if (settings.tag) {
      return { type: "tag", value: settings.tag };
    }
    return { type: "branch", value: settings.branch ?? "main" };
  }

  /**
   * Check if the directory contains a git repository.
   */
  private async isCloned(dirPath: string): Promise<boolean> {
    try {
      const gitDir = join(dirPath, ".git");
      const stat = await Deno.stat(gitDir);
      return stat.isDirectory;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get the current remote origin URL from an existing repo.
   */
  private async getCurrentRemoteUrl(dirPath: string): Promise<string | null> {
    try {
      const remotes = await git.listRemotes({
        fs: denoFs,
        dir: dirPath,
      });
      const origin = remotes.find((r) => r.remote === "origin");
      return origin?.url ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Strip authentication from URL for comparison.
   */
  private stripAuthFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      urlObj.username = "";
      urlObj.password = "";
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * Check if we need to reclone (URL changed).
   */
  private async needsReclone(
    settings: GitTypeSettings,
    dirPath: string,
  ): Promise<boolean> {
    const currentUrl = await this.getCurrentRemoteUrl(dirPath);
    if (!currentUrl) {
      return true; // Can't determine current URL, reclone to be safe
    }

    const strippedCurrent = this.stripAuthFromUrl(currentUrl);
    const strippedNew = this.stripAuthFromUrl(settings.url);

    return strippedCurrent !== strippedNew;
  }

  /**
   * Delete directory contents but keep the directory itself.
   */
  private async deleteDirectoryContents(dirPath: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dirPath)) {
        const entryPath = join(dirPath, entry.name);
        await Deno.remove(entryPath, { recursive: true });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  /**
   * Perform initial clone.
   */
  private async performClone(
    settings: GitTypeSettings,
    dirPath: string,
    token: CancellationToken,
    startTime: number,
  ): Promise<SyncResult> {
    const targetRef = this.getTargetRef(settings);

    // Ensure parent directory exists
    await Deno.mkdir(dirPath, { recursive: true });

    // Clone into a temporary directory first, then move
    // This ensures we don't leave a partial clone if something fails
    const tempDir = `${dirPath}.tmp.${Date.now()}`;

    try {
      token.throwIfCancelled();

      // Determine ref to clone
      let ref: string | undefined;
      if (targetRef.type === "branch") {
        ref = targetRef.value;
      } else if (targetRef.type === "tag") {
        ref = targetRef.value;
      }
      // For commit, we clone default branch and checkout later

      // Execute clone with isomorphic-git
      await git.clone({
        fs: denoFs,
        http,
        dir: tempDir,
        url: settings.url,
        ref,
        singleBranch: true,
        depth: targetRef.type === "commit" ? undefined : 1, // Shallow clone unless we need specific commit
        onAuth: this.createAuthCallback(settings.authToken),
      });

      token.throwIfCancelled();

      // For commit-based checkout, we need to fetch and checkout the specific commit
      if (targetRef.type === "commit") {
        await git.fetch({
          fs: denoFs,
          http,
          dir: tempDir,
          url: settings.url,
          onAuth: this.createAuthCallback(settings.authToken),
        });

        token.throwIfCancelled();

        await git.checkout({
          fs: denoFs,
          dir: tempDir,
          ref: targetRef.value,
          force: true,
        });
      }

      token.throwIfCancelled();

      // Remove the target directory if it exists (it should be empty or non-existent)
      try {
        await Deno.remove(dirPath, { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }

      // Rename temp to target
      await Deno.rename(tempDir, dirPath);

      const durationMs = Date.now() - startTime;
      return {
        success: true,
        filesChanged: await this.countFiles(dirPath),
        durationMs,
      };
    } catch (error) {
      // Clean up temp directory on failure
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }

      // Convert isomorphic-git errors to GitOperationError
      if (error instanceof Error) {
        throw new GitOperationError("clone", 1, error.message);
      }
      throw error;
    }
  }

  /**
   * Fetch from remote and reset to target ref.
   */
  private async performFetchAndReset(
    settings: GitTypeSettings,
    dirPath: string,
    token: CancellationToken,
    startTime: number,
  ): Promise<SyncResult> {
    const targetRef = this.getTargetRef(settings);

    // Get current HEAD before fetch
    let oldHead = "";
    try {
      oldHead = await git.resolveRef({
        fs: denoFs,
        dir: dirPath,
        ref: "HEAD",
      });
    } catch {
      // Ignore if we can't get HEAD
    }

    token.throwIfCancelled();

    // Update remote URL if needed
    try {
      await git.deleteRemote({
        fs: denoFs,
        dir: dirPath,
        remote: "origin",
      });
    } catch {
      // Ignore if remote doesn't exist
    }

    await git.addRemote({
      fs: denoFs,
      dir: dirPath,
      remote: "origin",
      url: settings.url,
    });

    token.throwIfCancelled();

    // Fetch all refs including tags
    await git.fetch({
      fs: denoFs,
      http,
      dir: dirPath,
      url: settings.url,
      tags: true,
      prune: true,
      onAuth: this.createAuthCallback(settings.authToken),
    });

    token.throwIfCancelled();

    // Determine checkout target
    let checkoutRef: string;
    if (targetRef.type === "commit") {
      checkoutRef = targetRef.value;
    } else if (targetRef.type === "tag") {
      checkoutRef = targetRef.value;
    } else {
      // For branches, checkout origin/branch
      checkoutRef = `origin/${targetRef.value}`;
    }

    // Checkout with force (equivalent to reset --hard)
    await git.checkout({
      fs: denoFs,
      dir: dirPath,
      ref: checkoutRef,
      force: true,
    });

    token.throwIfCancelled();

    // Clean untracked files
    await this.cleanUntrackedFiles(dirPath);

    // Get new HEAD
    let newHead = "";
    try {
      newHead = await git.resolveRef({
        fs: denoFs,
        dir: dirPath,
        ref: "HEAD",
      });
    } catch {
      // Ignore if we can't get HEAD
    }

    // Count changed files if heads differ
    let filesChanged = 0;
    if (oldHead && newHead && oldHead !== newHead) {
      filesChanged = await this.countChangedFiles(dirPath, oldHead, newHead);
    }

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      filesChanged,
      durationMs,
    };
  }

  /**
   * Clean untracked files from the working directory.
   * isomorphic-git doesn't have a clean command, so we implement it manually.
   */
  private async cleanUntrackedFiles(dirPath: string): Promise<void> {
    try {
      // Get status of all files
      const statusMatrix = await git.statusMatrix({
        fs: denoFs,
        dir: dirPath,
      });

      // Find untracked files (HEAD=0, WORKDIR=2, STAGE=0)
      // Status matrix format: [filepath, HEAD, WORKDIR, STAGE]
      for (const [filepath, head, workdir, _stage] of statusMatrix) {
        if (head === 0 && workdir === 2) {
          // Untracked file - delete it
          const fullPath = join(dirPath, filepath);
          try {
            await Deno.remove(fullPath, { recursive: true });
          } catch {
            // Ignore deletion errors
          }
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Count files in a directory (excluding .git).
   */
  private async countFiles(dirPath: string): Promise<number> {
    let count = 0;
    try {
      for await (const entry of Deno.readDir(dirPath)) {
        if (entry.name === ".git") continue;
        if (entry.isFile) {
          count++;
        } else if (entry.isDirectory) {
          count += await this.countFiles(join(dirPath, entry.name));
        }
      }
    } catch {
      // Ignore errors, return current count
    }
    return count;
  }

  /**
   * Count changed files between two commits using tree walking.
   */
  private async countChangedFiles(
    dirPath: string,
    oldHead: string,
    newHead: string,
  ): Promise<number> {
    try {
      const changedFiles = new Set<string>();

      // Walk both trees and find differences
      await git.walk({
        fs: denoFs,
        dir: dirPath,
        trees: [git.TREE({ ref: oldHead }), git.TREE({ ref: newHead })],
        map: async (filepath, [oldEntry, newEntry]) => {
          // Skip .git directory
          if (filepath === ".git" || filepath.startsWith(".git/")) {
            return null;
          }

          const oldOid = oldEntry ? await oldEntry.oid() : null;
          const newOid = newEntry ? await newEntry.oid() : null;

          if (oldOid !== newOid) {
            changedFiles.add(filepath);
          }

          return null;
        },
      });

      return changedFiles.size;
    } catch {
      return 0;
    }
  }
}
