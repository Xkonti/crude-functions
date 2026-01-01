import type { Context } from "@hono/hono";
import type { ApiKeyExtractor, ApiKeyExtractResult } from "./types.ts";
import { logger } from "../../utils/logger.ts";

/**
 * Default query parameter names to check for API keys
 */
const DEFAULT_PARAMS = ["api_key", "apiKey"] as const;

/**
 * Extracts API keys from URL query parameters.
 * This should typically be the last extractor in the chain as query params
 * are less secure (can appear in logs, browser history, etc.)
 */
export class QueryParamExtractor implements ApiKeyExtractor {
  readonly name = "QueryParam";
  private readonly params: readonly string[];

  constructor(params: readonly string[] = DEFAULT_PARAMS) {
    this.params = params;
  }

  extract(c: Context): ApiKeyExtractResult | null {
    const url = new URL(c.req.url);
    for (const param of this.params) {
      const value = url.searchParams.get(param);
      if (value) {
        logger.debug(`API key extracted from query parameter: ${param}`);
        return {
          key: value,
          source: `query:${param}`,
        };
      }
    }
    return null;
  }
}
