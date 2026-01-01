export type { ApiKeyExtractor, ApiKeyExtractResult } from "./types.ts";
export { HeaderExtractor } from "./header_extractor.ts";
export { AuthorizationExtractor } from "./authorization_extractor.ts";
export { QueryParamExtractor } from "./query_extractor.ts";

import { HeaderExtractor } from "./header_extractor.ts";
import { AuthorizationExtractor } from "./authorization_extractor.ts";
import { QueryParamExtractor } from "./query_extractor.ts";
import type { ApiKeyExtractor } from "./types.ts";

/**
 * Creates the default chain of API key extractors in priority order:
 * 1. Authorization header (Bearer, plain, Basic)
 * 2. Custom headers (X-API-Key, X-Auth-Token, Api-Key, X-Access-Token)
 * 3. Query parameters (api_key, apiKey) - checked last
 */
export function createDefaultExtractors(): ApiKeyExtractor[] {
  return [
    new AuthorizationExtractor(),
    new HeaderExtractor(),
    new QueryParamExtractor(),
  ];
}
