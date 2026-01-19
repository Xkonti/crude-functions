import type { CancellationToken } from "./types.ts";
import { JobCancellationError } from "./errors.ts";

/**
 * Implementation of CancellationToken for job handlers.
 *
 * This class is used internally by JobProcessorService to signal
 * cancellation to handlers. Handlers receive the CancellationToken interface
 * and can check for cancellation without access to the internal _cancel method.
 *
 * Usage in handlers:
 * ```typescript
 * async function handler(job: Job, token: CancellationToken) {
 *   // Option 1: Check periodically
 *   for (const item of items) {
 *     if (token.isCancelled) {
 *       return { partial: true, processed: someItems };
 *     }
 *     await processItem(item);
 *   }
 *
 *   // Option 2: Throw if cancelled
 *   token.throwIfCancelled();
 *
 *   // Option 3: Race with cancellation
 *   await Promise.race([
 *     longRunningOperation(),
 *     token.whenCancelled.then(() => { throw new Error('Cancelled'); })
 *   ]);
 * }
 * ```
 */
export class CancellationTokenImpl implements CancellationToken {
  private _isCancelled = false;
  private _reason?: string;
  private _jobId: number;
  private _resolveWhenCancelled?: () => void;
  private _whenCancelledPromise: Promise<void>;

  constructor(jobId: number) {
    this._jobId = jobId;
    this._whenCancelledPromise = new Promise<void>((resolve) => {
      this._resolveWhenCancelled = resolve;
    });
  }

  /**
   * Whether cancellation has been requested.
   */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * The reason for cancellation, if provided.
   */
  get reason(): string | undefined {
    return this._reason;
  }

  /**
   * Promise that resolves when cancellation is requested.
   * Useful for racing with long-running operations.
   */
  get whenCancelled(): Promise<void> {
    return this._whenCancelledPromise;
  }

  /**
   * Throws JobCancellationError if cancellation was requested.
   * Call this at safe points in your handler to bail out cleanly.
   */
  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new JobCancellationError(this._jobId, this._reason);
    }
  }

  /**
   * @internal Called by JobProcessorService when cancellation is detected.
   */
  _cancel(reason?: string): void {
    if (this._isCancelled) {
      return; // Already cancelled
    }
    this._isCancelled = true;
    this._reason = reason;
    this._resolveWhenCancelled?.();
  }
}
