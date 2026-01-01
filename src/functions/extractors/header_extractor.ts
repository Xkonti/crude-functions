import type { Context } from "@hono/hono";
import type { ApiKeyExtractor, ApiKeyExtractResult } from "./types.ts";
import { logger } from "../../utils/logger.ts";

/**
 * Default headers to check for API keys (in priority order)
 */
const DEFAULT_HEADERS = [
  "X-API-Key",
  "X-Auth-Token",
  "Api-Key",
  "X-Access-Token",
] as const;

/**
 * Extracts API keys from custom headers like X-API-Key, X-Auth-Token, etc.
 */
export class HeaderExtractor implements ApiKeyExtractor {
  readonly name = "Header";
  private readonly headers: readonly string[];

  constructor(headers: readonly string[] = DEFAULT_HEADERS) {
    this.headers = headers;
  }

  extract(c: Context): ApiKeyExtractResult | null {
    for (const header of this.headers) {
      const value = c.req.header(header);
      if (value) {
        logger.debug(`API key extracted from ${header} header`);
        return {
          key: value,
          source: `${header} header`,
        };
      }
    }
    return null;
  }
}
