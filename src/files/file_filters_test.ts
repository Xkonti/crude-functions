import { expect } from "@std/expect";
import { isGitPath, isCodeFile, filterHandlerFiles } from "./file_filters.ts";

// =============================================================================
// isGitPath tests
// =============================================================================

Deno.test("isGitPath returns true for .git directory", () => {
  expect(isGitPath(".git")).toBe(true);
  expect(isGitPath(".git/")).toBe(true);
});

Deno.test("isGitPath returns true for files inside .git directory", () => {
  expect(isGitPath(".git/config")).toBe(true);
  expect(isGitPath(".git/hooks/pre-commit")).toBe(true);
  expect(isGitPath(".git/objects/pack/something.pack")).toBe(true);
});

Deno.test("isGitPath returns true for .git inside source directories", () => {
  expect(isGitPath("my-repo/.git")).toBe(true);
  expect(isGitPath("my-repo/.git/config")).toBe(true);
  expect(isGitPath("source/nested/.git/hooks/pre-commit")).toBe(true);
});

Deno.test("isGitPath returns false for regular files", () => {
  expect(isGitPath("handler.ts")).toBe(false);
  expect(isGitPath("src/utils/helper.ts")).toBe(false);
  expect(isGitPath("my-repo/src/main.ts")).toBe(false);
});

Deno.test("isGitPath returns false for hidden files that are not .git", () => {
  expect(isGitPath(".env")).toBe(false);
  expect(isGitPath(".hidden-file.ts")).toBe(false);
  expect(isGitPath("src/.config")).toBe(false);
  expect(isGitPath(".github/workflows/ci.yml")).toBe(false);
});

Deno.test("isGitPath returns false for files containing 'git' in name", () => {
  expect(isGitPath("gitignore-helper.ts")).toBe(false);
  expect(isGitPath("src/git-utils.ts")).toBe(false);
  expect(isGitPath(".gitignore")).toBe(false); // Not inside .git directory
});

// =============================================================================
// isCodeFile tests
// =============================================================================

Deno.test("isCodeFile returns true for TypeScript files", () => {
  expect(isCodeFile("handler.ts")).toBe(true);
  expect(isCodeFile("src/utils/helper.ts")).toBe(true);
  expect(isCodeFile("component.tsx")).toBe(true);
});

Deno.test("isCodeFile returns true for JavaScript files", () => {
  expect(isCodeFile("script.js")).toBe(true);
  expect(isCodeFile("src/utils/helper.js")).toBe(true);
  expect(isCodeFile("component.jsx")).toBe(true);
});

Deno.test("isCodeFile returns false for non-code files", () => {
  expect(isCodeFile("readme.md")).toBe(false);
  expect(isCodeFile("config.json")).toBe(false);
  expect(isCodeFile("styles.css")).toBe(false);
  expect(isCodeFile("image.png")).toBe(false);
  expect(isCodeFile("data.yaml")).toBe(false);
});

Deno.test("isCodeFile returns false for files without extension", () => {
  expect(isCodeFile("Dockerfile")).toBe(false);
  expect(isCodeFile("Makefile")).toBe(false);
  expect(isCodeFile(".gitignore")).toBe(false);
});

Deno.test("isCodeFile is case-insensitive for extensions", () => {
  expect(isCodeFile("Handler.TS")).toBe(true);
  expect(isCodeFile("Script.JS")).toBe(true);
  expect(isCodeFile("Component.TSX")).toBe(true);
  expect(isCodeFile("App.JSX")).toBe(true);
});

Deno.test("isCodeFile handles hidden TypeScript files", () => {
  expect(isCodeFile(".env.ts")).toBe(true);
  expect(isCodeFile(".hidden-helper.ts")).toBe(true);
});

// =============================================================================
// filterHandlerFiles tests
// =============================================================================

Deno.test("filterHandlerFiles filters out .git paths", () => {
  const paths = [
    "handler.ts",
    ".git/config",
    "my-repo/.git/hooks/pre-commit",
    "src/utils.ts",
  ];
  const filtered = filterHandlerFiles(paths);
  expect(filtered).toEqual(["handler.ts", "src/utils.ts"]);
});

Deno.test("filterHandlerFiles filters out non-code files", () => {
  const paths = [
    "handler.ts",
    "readme.md",
    "config.json",
    "utils.js",
    "image.png",
  ];
  const filtered = filterHandlerFiles(paths);
  expect(filtered).toEqual(["handler.ts", "utils.js"]);
});

Deno.test("filterHandlerFiles keeps hidden TypeScript files", () => {
  const paths = [
    "handler.ts",
    ".env.ts",
    ".hidden-helper.ts",
    ".github/workflows/ci.yml",
  ];
  const filtered = filterHandlerFiles(paths);
  expect(filtered).toEqual(["handler.ts", ".env.ts", ".hidden-helper.ts"]);
});

Deno.test("filterHandlerFiles combines all filters", () => {
  const paths = [
    "my-repo/src/handler.ts",      // Keep: code file in repo
    "my-repo/.git/config",          // Remove: .git path
    "my-repo/readme.md",            // Remove: not code file
    "my-repo/.env.ts",              // Keep: hidden code file
    "other-source/utils.jsx",       // Keep: JSX file
    ".git/objects/pack.ts",         // Remove: .git path (even with .ts)
  ];
  const filtered = filterHandlerFiles(paths);
  expect(filtered).toEqual([
    "my-repo/src/handler.ts",
    "my-repo/.env.ts",
    "other-source/utils.jsx",
  ]);
});

Deno.test("filterHandlerFiles returns empty array for empty input", () => {
  expect(filterHandlerFiles([])).toEqual([]);
});

Deno.test("filterHandlerFiles returns empty array when all files are filtered", () => {
  const paths = [
    ".git/config",
    "readme.md",
    "data.json",
  ];
  expect(filterHandlerFiles(paths)).toEqual([]);
});
