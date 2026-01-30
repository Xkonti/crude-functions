/**
 * File filtering utilities for handler autocomplete.
 *
 * Provides functions to filter file paths for relevant handler files,
 * excluding .git directories and non-code files.
 */

/** Code file extensions that can be used as handlers */
const CODE_EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];

/**
 * Checks if a path is inside a .git directory.
 *
 * Returns true if any segment of the path is exactly ".git".
 * This includes the .git directory itself and any files inside it.
 *
 * @example
 * isGitPath(".git/config") // true
 * isGitPath("my-repo/.git/hooks/pre-commit") // true
 * isGitPath(".gitignore") // false
 * isGitPath("src/git-utils.ts") // false
 */
export function isGitPath(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment) => segment === ".git");
}

/**
 * Checks if a path is a code file (TypeScript or JavaScript).
 *
 * Returns true if the file has one of these extensions:
 * .ts, .js, .tsx, .jsx (case-insensitive)
 *
 * @example
 * isCodeFile("handler.ts") // true
 * isCodeFile("readme.md") // false
 * isCodeFile(".env.ts") // true
 */
export function isCodeFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return CODE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

/**
 * Filters a list of file paths to only include valid handler files.
 *
 * A valid handler file:
 * - Is NOT inside a .git directory
 * - IS a code file (.ts, .js, .tsx, .jsx)
 *
 * Hidden files (starting with .) are NOT excluded as they can be valid handlers.
 *
 * @example
 * filterHandlerFiles([
 *   "handler.ts",
 *   ".git/config",
 *   "readme.md",
 *   ".env.ts"
 * ])
 * // Returns: ["handler.ts", ".env.ts"]
 */
export function filterHandlerFiles(paths: string[]): string[] {
  return paths.filter((path) => !isGitPath(path) && isCodeFile(path));
}
