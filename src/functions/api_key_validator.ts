import type { Context } from "@hono/hono";
import type { ApiKeyService } from "../keys/api_key_service.ts";

export interface ApiKeyValidationResult {
  /** Whether the API key is valid */
  valid: boolean;
  /** Which key name matched (e.g., "api-key", "admin") */
  keyName?: string;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Validates API keys against allowed key names for function routes
 */
export class ApiKeyValidator {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /**
   * Validate API key against allowed key names
   * @param c - Hono context (to read X-API-Key header)
   * @param allowedKeyNames - Array of key names to check against
   * @returns Validation result with matched key name if successful
   */
  async validate(
    c: Context,
    allowedKeyNames: string[]
  ): Promise<ApiKeyValidationResult> {
    const apiKey = c.req.header("X-API-Key");

    if (!apiKey) {
      return {
        valid: false,
        error: "Missing X-API-Key header",
      };
    }

    // Check each allowed key name
    for (const keyName of allowedKeyNames) {
      const hasKey = await this.apiKeyService.hasKey(keyName, apiKey);
      if (hasKey) {
        return {
          valid: true,
          keyName,
        };
      }
    }

    return {
      valid: false,
      error: "Invalid API key",
    };
  }
}
