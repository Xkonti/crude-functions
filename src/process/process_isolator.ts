import process from "node:process";
import { getCurrentRequestContext } from "../logs/request_context.ts";

/**
 * Original process/Deno references - stored before replacement.
 * Kept private to prevent handlers from accessing them directly.
 * System code uses these when outside handler context.
 */
let originalDenoExit: typeof Deno.exit;
let originalDenoChdir: typeof Deno.chdir;
let originalProcessExit: typeof process.exit;
let originalProcessChdir: typeof process.chdir;

/**
 * Intercepts process control methods to prevent handlers from:
 * - Exiting the server process (Deno.exit, process.exit)
 * - Changing working directory globally (Deno.chdir, process.chdir)
 *
 * Must be installed AFTER other setup but BEFORE any handlers load.
 *
 * When inside handler context (runInRequestContext):
 * - All four methods throw clear errors
 *
 * When outside handler context (system code):
 * - All methods work normally
 */
export class ProcessIsolator {
  private isInstalled = false;

  /**
   * Install the process method interceptors.
   * Call this once at application startup, after env isolation.
   */
  install(): void {
    if (this.isInstalled) return;

    // Store references to original methods
    originalDenoExit = Deno.exit;
    originalDenoChdir = Deno.chdir;
    originalProcessExit = process.exit;
    originalProcessChdir = process.chdir;

    // Replace Deno.exit
    Deno.exit = (code?: number): never => {
      const ctx = getCurrentRequestContext();
      if (ctx) {
        throw new Error(
          "Function handlers cannot call Deno.exit(). " +
          "Return a response instead."
        );
      }
      return originalDenoExit(code);
    };

    // Replace Deno.chdir
    Deno.chdir = (directory: string | URL): void => {
      const ctx = getCurrentRequestContext();
      if (ctx) {
        throw new Error(
          "Function handlers cannot change working directory. " +
          "Use absolute paths instead."
        );
      }
      return originalDenoChdir(directory);
    };

    // Replace process.exit
    process.exit = (code?: number): never => {
      const ctx = getCurrentRequestContext();
      if (ctx) {
        throw new Error(
          "Function handlers cannot call process.exit(). " +
          "Return a response instead."
        );
      }
      return originalProcessExit(code);
    };

    // Replace process.chdir
    process.chdir = (directory: string): void => {
      const ctx = getCurrentRequestContext();
      if (ctx) {
        throw new Error(
          "Function handlers cannot change working directory. " +
          "Use absolute paths instead."
        );
      }
      return originalProcessChdir(directory);
    };

    this.isInstalled = true;
  }

  /**
   * Restore original process methods.
   * Primarily useful for testing.
   */
  uninstall(): void {
    if (!this.isInstalled) return;

    Deno.exit = originalDenoExit;
    Deno.chdir = originalDenoChdir;
    process.exit = originalProcessExit;
    process.chdir = originalProcessChdir;

    this.isInstalled = false;
  }

  /**
   * Check if the isolator is currently installed.
   */
  get installed(): boolean {
    return this.isInstalled;
  }
}

/**
 * Get references to original process methods.
 *
 * WARNING: This is for TESTING ONLY. Do not use in production code.
 * Handler code should NEVER import or use this function.
 *
 * @internal
 */
export function _getOriginalsForTesting() {
  if (!originalDenoExit) {
    throw new Error("ProcessIsolator.install() must be called before accessing originals");
  }
  return {
    denoExit: originalDenoExit,
    denoChdir: originalDenoChdir,
    processExit: originalProcessExit,
    processChdir: originalProcessChdir,
  };
}
