import type { Context } from "@hono/hono";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { ApiKeyExtractor } from "./extractors/mod.ts";
import { createDefaultExtractors } from "./extractors/mod.ts";
import { logger } from "../utils/logger.ts";

export interface ApiKeyValidationResult {
  /** Whether the API key is valid */
  valid: boolean;
  /** Which key name matched (e.g., "api-key", "admin") */
  keyName?: string;
  /** Where the API key was found (e.g., "X-API-Key header", "Authorization Bearer") */
  source?: string;
  /** Error message if validation failed */
  error?: string;
}

export interface ApiKeyValidatorOptions {
  apiKeyService: ApiKeyService;
  /** Custom extractors to use. If not provided, uses default extractors. */
  extractors?: ApiKeyExtractor[];
}

/**
 * Validates API keys against allowed key names for function routes.
 * Supports multiple locations for API key extraction.
 */
export class ApiKeyValidator {
  private readonly apiKeyService: ApiKeyService;
  private readonly extractors: ApiKeyExtractor[];

  constructor(options: ApiKeyValidatorOptions) {
    this.apiKeyService = options.apiKeyService;
    this.extractors = options.extractors ?? createDefaultExtractors();
  }

  /**
   * Validate API key against allowed key names
   * @param c - Hono context
   * @param allowedKeyNames - Array of key names to check against
   * @returns Validation result with matched key name and source if successful
   */
  async validate(
    c: Context,
    allowedKeyNames: string[]
  ): Promise<ApiKeyValidationResult> {
    // Try each extractor in order until one finds a key
    let apiKey: string | null = null;
    let source: string | null = null;

    for (const extractor of this.extractors) {
      const result = extractor.extract(c);
      if (result) {
        apiKey = result.key;
        source = result.source;
        break;
      }
    }

    if (!apiKey) {
      logger.debug("API key validation failed: no API key found in request");
      return {
        valid: false,
        error: "Missing API key",
      };
    }

    // Check each allowed key name
    for (const keyName of allowedKeyNames) {
      const hasKey = await this.apiKeyService.hasKey(keyName, apiKey);
      if (hasKey) {
        logger.debug(`API key validated successfully (key name: ${keyName}, source: ${source})`);
        return {
          valid: true,
          keyName,
          source: source!,
        };
      }
    }

    logger.debug(`API key validation failed: key not found (source: ${source})`);
    return {
      valid: false,
      error: "Invalid API key",
    };
  }
}
