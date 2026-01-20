import { join } from "@std/path";
import type {
  CodeSource,
  CodeSourceProvider,
  GitTypeSettings,
  ProviderCapabilities,
  SyncResult,
} from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";
import { GitOperationError } from "./errors.ts";

export interface GitCodeSourceProviderOptions {
  /** Base code directory (e.g., "./code") */
  codeDirectory: string;
}

interface GitCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface TargetRef {
  type: "branch" | "tag" | "commit";
  value: string;
}

/**
 * Provider for git-based code sources.
 *
 * Git sources sync files from a remote git repository. The local directory
 * is managed by git and should not be modified directly.
 *
 * Capabilities:
 * - isSyncable: true (can sync from remote git repo)
 * - isEditable: false (files come from git, not editable via API)
 */
export class GitCodeSourceProvider implements CodeSourceProvider {
  readonly type = "git" as const;
  private readonly codeDirectory: string;

  constructor(options: GitCodeSourceProviderOptions) {
    this.codeDirectory = options.codeDirectory;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      isSyncable: true, // Can sync from remote git repo
      isEditable: false, // Files managed by git, not editable via API
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
   * Execute a git command and return the result.
   */
  private async runGitCommand(
    args: string[],
    cwd: string,
    token: CancellationToken,
  ): Promise<GitCommandResult> {
    token.throwIfCancelled();

    const command = new Deno.Command("git", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    const { code, stdout, stderr } = await process.output();

    token.throwIfCancelled();

    return {
      success: code === 0,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      exitCode: code,
    };
  }

  /**
   * Build URL with embedded auth token.
   * Example: https://github.com/user/repo.git -> https://token@github.com/user/repo.git
   */
  private buildAuthenticatedUrl(url: string, authToken?: string): string {
    if (!authToken) {
      return url;
    }

    try {
      const urlObj = new URL(url);
      urlObj.username = authToken;
      urlObj.password = "";
      return urlObj.toString();
    } catch {
      // If URL parsing fails, return original
      return url;
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
      const command = new Deno.Command("git", {
        args: ["remote", "get-url", "origin"],
        cwd: dirPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout } = await command.output();
      if (code !== 0) {
        return null;
      }

      return new TextDecoder().decode(stdout).trim();
    } catch {
      return null;
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
    const authUrl = this.buildAuthenticatedUrl(settings.url, settings.authToken);
    const targetRef = this.getTargetRef(settings);

    // Ensure parent directory exists
    await Deno.mkdir(dirPath, { recursive: true });

    // Clone into a temporary directory first, then move
    // This ensures we don't leave a partial clone if something fails
    const tempDir = `${dirPath}.tmp.${Date.now()}`;

    try {
      token.throwIfCancelled();

      // Build clone args
      const cloneArgs = ["clone", "--single-branch"];

      if (targetRef.type === "branch") {
        cloneArgs.push("--branch", targetRef.value);
      } else if (targetRef.type === "tag") {
        cloneArgs.push("--branch", targetRef.value);
      }
      // For commit, we clone without branch filter and checkout later

      cloneArgs.push(authUrl, tempDir);

      // Execute clone
      const cloneResult = await this.runGitCommand(
        cloneArgs,
        this.codeDirectory,
        token,
      );

      if (!cloneResult.success) {
        throw new GitOperationError(
          "clone",
          cloneResult.exitCode,
          cloneResult.stderr,
        );
      }

      // For commit-based checkout, we need to fetch and checkout the specific commit
      if (targetRef.type === "commit") {
        const checkoutResult = await this.runGitCommand(
          ["checkout", targetRef.value],
          tempDir,
          token,
        );

        if (!checkoutResult.success) {
          throw new GitOperationError(
            "checkout",
            checkoutResult.exitCode,
            checkoutResult.stderr,
          );
        }
      }

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
    const oldHeadResult = await this.runGitCommand(
      ["rev-parse", "HEAD"],
      dirPath,
      token,
    );
    const oldHead = oldHeadResult.success ? oldHeadResult.stdout.trim() : "";

    // Update remote URL if auth token changed
    const authUrl = this.buildAuthenticatedUrl(settings.url, settings.authToken);
    await this.runGitCommand(
      ["remote", "set-url", "origin", authUrl],
      dirPath,
      token,
    );

    // Fetch all refs
    const fetchResult = await this.runGitCommand(
      ["fetch", "--all", "--tags", "--prune"],
      dirPath,
      token,
    );

    if (!fetchResult.success) {
      throw new GitOperationError(
        "fetch",
        fetchResult.exitCode,
        fetchResult.stderr,
      );
    }

    // Determine reset target
    let resetTarget: string;
    if (targetRef.type === "commit") {
      resetTarget = targetRef.value;
    } else if (targetRef.type === "tag") {
      resetTarget = `tags/${targetRef.value}`;
    } else {
      resetTarget = `origin/${targetRef.value}`;
    }

    // Reset to target
    const resetResult = await this.runGitCommand(
      ["reset", "--hard", resetTarget],
      dirPath,
      token,
    );

    if (!resetResult.success) {
      throw new GitOperationError(
        "reset",
        resetResult.exitCode,
        resetResult.stderr,
      );
    }

    // Clean untracked files
    await this.runGitCommand(["clean", "-fd"], dirPath, token);

    // Get new HEAD
    const newHeadResult = await this.runGitCommand(
      ["rev-parse", "HEAD"],
      dirPath,
      token,
    );
    const newHead = newHeadResult.success ? newHeadResult.stdout.trim() : "";

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
   * Count changed files between two commits.
   */
  private async countChangedFiles(
    dirPath: string,
    oldHead: string,
    newHead: string,
  ): Promise<number> {
    try {
      const result = await this.runGitCommand(
        ["diff", "--name-only", oldHead, newHead],
        dirPath,
        { isCancelled: false, throwIfCancelled: () => {}, whenCancelled: new Promise(() => {}) },
      );

      if (!result.success) {
        return 0;
      }

      const lines = result.stdout.trim().split("\n").filter((l) => l.length > 0);
      return lines.length;
    } catch {
      return 0;
    }
  }
}
