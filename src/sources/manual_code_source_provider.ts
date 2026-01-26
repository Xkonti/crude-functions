import { join } from "@std/path";
import type {
  CodeSourceProvider,
  CodeSource,
  ProviderCapabilities,
  SyncResult,
  TypeSettings,
} from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";

export interface ManualCodeSourceProviderOptions {
  /** Base code directory (e.g., "./code") */
  codeDirectory: string;
}

/**
 * Provider for manual code sources.
 *
 * Manual sources are directories where files are managed directly via the API.
 * They have no external source to sync from - the local filesystem is the
 * source of truth.
 *
 * Capabilities:
 * - isSyncable: false (nothing to sync from)
 * - isEditable: true (files can be managed via API)
 */
export class ManualCodeSourceProvider implements CodeSourceProvider {
  readonly type = "manual" as const;
  private readonly codeDirectory: string;

  constructor(options: ManualCodeSourceProviderOptions) {
    this.codeDirectory = options.codeDirectory;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      isSyncable: false, // Manual sources have no remote to sync from
      isEditable: true, // Files can be managed via API
    };
  }

  // ===========================================================================
  // Encryption methods (no-op - manual sources have no sensitive fields)
  // ===========================================================================

  /**
   * No-op for manual sources - no sensitive fields to encrypt.
   */
  encryptSensitiveFields(settings: TypeSettings): Promise<TypeSettings> {
    return Promise.resolve(settings);
  }

  /**
   * No-op for manual sources - no sensitive fields to decrypt.
   */
  decryptSensitiveFields(settings: TypeSettings): Promise<TypeSettings> {
    return Promise.resolve(settings);
  }

  /**
   * Sync is a no-op for manual sources.
   * Returns immediate success since there's nothing to sync from.
   */
  sync(
    _source: CodeSource,
    _token: CancellationToken
  ): Promise<SyncResult> {
    return Promise.resolve({
      success: true,
      filesChanged: 0,
      durationMs: 0,
    });
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
}
