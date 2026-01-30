/**
 * Fuzzy search utilities for file path matching.
 *
 * Implements subsequence matching with scoring to find
 * file paths that match a user's query even with typos
 * or partial input.
 */

/**
 * Result of a fuzzy match operation.
 */
export interface FuzzyMatch {
  /** The matched file path */
  path: string;
  /** Match score (higher is better) */
  score: number;
  /** Character indices in the path that matched the query */
  matchPositions: number[];
}

/**
 * Attempts to match a query against a path using subsequence matching.
 *
 * Returns a FuzzyMatch if all query characters appear in order in the path,
 * or null if no match is found.
 *
 * Scoring:
 * - +2 points for consecutive character matches
 * - +1 point for non-consecutive matches
 * - +3 bonus for matches at start of path segments (after / or at position 0)
 * - Score is normalized by query length and penalized slightly for longer paths
 *
 * @example
 * fuzzyMatch("hand", "handler.ts")  // matches with high score
 * fuzzyMatch("hndl", "handler.ts")  // matches with lower score (non-consecutive)
 * fuzzyMatch("xyz", "handler.ts")   // returns null
 */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | null {
  const queryLower = query.toLowerCase();
  const pathLower = path.toLowerCase();

  // Empty query matches everything with zero score
  if (queryLower.length === 0) {
    return { path, score: 0, matchPositions: [] };
  }

  let queryIdx = 0;
  let score = 0;
  const matchPositions: number[] = [];
  let lastMatchIdx = -1;

  for (
    let pathIdx = 0;
    pathIdx < pathLower.length && queryIdx < queryLower.length;
    pathIdx++
  ) {
    if (pathLower[pathIdx] === queryLower[queryIdx]) {
      matchPositions.push(pathIdx);

      // Consecutive match bonus
      if (lastMatchIdx === pathIdx - 1) {
        score += 2;
      } else {
        score += 1;
      }

      // Start of segment bonus (after / or at position 0)
      if (pathIdx === 0 || path[pathIdx - 1] === "/") {
        score += 3;
      }

      lastMatchIdx = pathIdx;
      queryIdx++;
    }
  }

  // Must match all query characters
  if (queryIdx !== queryLower.length) {
    return null;
  }

  // Normalize score:
  // - Divide by query length to make scores comparable across queries
  // - Slightly penalize longer paths (prefer shorter matches)
  const normalizedScore = score / (queryLower.length + pathLower.length * 0.1);

  return { path, score: normalizedScore, matchPositions };
}

/**
 * Searches multiple paths for fuzzy matches and returns sorted results.
 *
 * Filters out non-matching paths and sorts by score (highest first).
 *
 * @param query - The search query
 * @param paths - Array of file paths to search
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Array of FuzzyMatch objects sorted by score
 *
 * @example
 * fuzzySearch("hand", ["handler.ts", "other.ts", "handle.js"])
 * // Returns matches for "handler.ts" and "handle.js", sorted by score
 */
export function fuzzySearch(
  query: string,
  paths: string[],
  limit: number = 10
): FuzzyMatch[] {
  const matches: FuzzyMatch[] = [];

  for (const path of paths) {
    const match = fuzzyMatch(query, path);
    if (match !== null) {
      matches.push(match);
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  // Return up to limit results
  return matches.slice(0, limit);
}
