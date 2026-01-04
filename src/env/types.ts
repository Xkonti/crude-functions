/**
 * Context for isolated environment variable storage.
 * Each handler execution gets a fresh instance.
 */
export interface EnvContext {
  /** Isolated environment variable store for this request */
  store: Map<string, string>;
}

/**
 * Full Deno.env interface for proxy implementation.
 * Matches the Deno.Env interface from https://docs.deno.com/api/deno/~/Deno.Env
 */
export interface DenoEnvInterface {
  /** Returns the value of an environment variable if it exists, otherwise undefined */
  get(key: string): string | undefined;

  /** Sets the value of an environment variable */
  set(key: string, value: string): void;

  /** Deletes an environment variable */
  delete(key: string): void;

  /** Returns true if the environment variable exists */
  has(key: string): boolean;

  /** Returns all environment variables as a key-value object */
  toObject(): { [key: string]: string };
}
