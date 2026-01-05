import type { DenoEnvInterface } from "./types.ts";
import { getCurrentEnvContext } from "./env_context.ts";

/**
 * Original Deno.env reference - stored before replacement.
 * Kept private to prevent handlers from accessing real env directly.
 * System code uses this when outside handler context.
 */
let originalDenoEnv: DenoEnvInterface;

/**
 * Replaces Deno.env with a proxy that provides:
 * - Isolated empty store when inside handler execution context
 * - Real Deno.env behavior when outside handler context (system code)
 *
 * Must be installed AFTER dotenv loads but BEFORE any handlers load.
 *
 * Since process.env is a Proxy that delegates to Deno.env, this
 * replacement also affects process.env automatically.
 */
export class EnvIsolator {
  private isInstalled = false;

  /**
   * Install the Deno.env proxy.
   * Call this once at application startup, after dotenv loads.
   */
  install(): void {
    if (this.isInstalled) return;

    // Store reference to original Deno.env
    originalDenoEnv = Deno.env;

    // Create proxy object that implements full Deno.env interface
    const envProxy: DenoEnvInterface = {
      get: (key: string): string | undefined => {
        const ctx = getCurrentEnvContext();
        if (ctx) {
          // Inside handler context - use isolated store
          return ctx.store.get(key);
        }
        // Outside handler context - use real env
        return originalDenoEnv.get(key);
      },

      set: (key: string, value: string): void => {
        const ctx = getCurrentEnvContext();
        if (ctx) {
          // Inside handler context - use isolated store
          ctx.store.set(key, value);
        } else {
          // Outside handler context - use real env
          originalDenoEnv.set(key, value);
        }
      },

      delete: (key: string): void => {
        const ctx = getCurrentEnvContext();
        if (ctx) {
          // Inside handler context - use isolated store
          ctx.store.delete(key);
        } else {
          // Outside handler context - use real env
          originalDenoEnv.delete(key);
        }
      },

      has: (key: string): boolean => {
        const ctx = getCurrentEnvContext();
        if (ctx) {
          // Inside handler context - use isolated store
          return ctx.store.has(key);
        }
        // Outside handler context - use real env
        return originalDenoEnv.has(key);
      },

      toObject: (): { [key: string]: string } => {
        const ctx = getCurrentEnvContext();
        if (ctx) {
          // Inside handler context - use isolated store
          return Object.fromEntries(ctx.store);
        }
        // Outside handler context - use real env
        return originalDenoEnv.toObject();
      },
    };

    // Replace Deno.env with our proxy
    Object.defineProperty(Deno, "env", {
      value: envProxy,
      writable: false,
      configurable: true,
    });

    this.isInstalled = true;
  }

  /**
   * Restore original Deno.env.
   * Primarily useful for testing.
   */
  uninstall(): void {
    if (!this.isInstalled) return;

    Object.defineProperty(Deno, "env", {
      value: originalDenoEnv,
      writable: false,
      configurable: true,
    });

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
 * Get reference to original Deno.env.
 *
 * WARNING: This is for TESTING ONLY. Do not use in production code.
 * Handler code should NEVER import or use this function.
 * All handler configuration should come from ctx.getSecret().
 *
 * @internal
 */
export function _getOriginalDenoEnvForTesting(): DenoEnvInterface {
  if (!originalDenoEnv) {
    throw new Error("EnvIsolator.install() must be called before accessing original env");
  }
  return originalDenoEnv;
}
