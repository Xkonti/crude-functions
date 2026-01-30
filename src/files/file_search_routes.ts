import { Hono } from "@hono/hono";
import { FileService } from "./file_service.ts";
import { filterHandlerFiles } from "./file_filters.ts";
import { fuzzySearch } from "./fuzzy_search.ts";

export interface FileSearchRoutesOptions {
  /** Base directory containing all code sources */
  codeDirectory: string;
}

/**
 * Creates routes for searching files across the code directory.
 *
 * API structure:
 * - GET /search?q=<query>&limit=<n> - Fuzzy search for handler files
 */
export function createFileSearchRoutes(
  options: FileSearchRoutesOptions
): Hono {
  const { codeDirectory } = options;
  const fileService = new FileService({ basePath: codeDirectory });
  const routes = new Hono();

  /**
   * GET /search - Fuzzy search for handler files
   *
   * Query parameters:
   * - q: Search query (required)
   * - limit: Maximum results (default 10, max 50)
   *
   * Response:
   * {
   *   matches: [{ path: string, score: number }]
   * }
   */
  routes.get("/search", async (c) => {
    const query = c.req.query("q");
    if (!query) {
      return c.json({ error: "Missing required query parameter: q" }, 400);
    }

    // Parse and validate limit
    const limitParam = c.req.query("limit");
    let limit = 10;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1) {
        return c.json({ error: "Invalid limit parameter" }, 400);
      }
      limit = Math.min(parsed, 50); // Cap at 50
    }

    // List all files in code directory
    const allFiles = await fileService.listFiles();

    // Filter to handler-eligible files (code files, not in .git)
    const handlerFiles = filterHandlerFiles(allFiles);

    // Apply fuzzy search
    const matches = fuzzySearch(query, handlerFiles, limit);

    // Return matches (strip matchPositions for cleaner response)
    return c.json({
      matches: matches.map(({ path, score }) => ({ path, score })),
    });
  });

  return routes;
}
