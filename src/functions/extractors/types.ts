import type { Context } from "@hono/hono";

/**
 * Result of successfully extracting an API key from a request
 */
export interface ApiKeyExtractResult {
  /** The extracted API key value */
  key: string;
  /** Description of where the key was found (e.g., "X-API-Key header", "Authorization Bearer") */
  source: string;
}

/**
 * Interface for API key extractors that can find keys in different request locations
 */
export interface ApiKeyExtractor {
  /** Human-readable name for this extractor */
  readonly name: string;

  /**
   * Attempt to extract an API key from the request
   * @param c - Hono context
   * @returns Extract result if key found, null otherwise
   */
  extract(c: Context): ApiKeyExtractResult | null;
}
