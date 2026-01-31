/**
 * Builds a vendor bundle for CodeMirror with SurrealDB syntax highlighting.
 * This bundles all CodeMirror packages together to avoid the "multiple instances
 * of @codemirror/state" issue that occurs with CDN imports.
 *
 * Run with: deno run -A scripts/build-codemirror.ts
 */

import * as esbuild from "npm:esbuild@0.24.0";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.11.0";

// Create a temporary entry file that imports the packages we need
const entryContent = `
export { basicSetup, EditorView } from "npm:codemirror@6.0.1";
export { json } from "npm:@codemirror/lang-json@6.0.1";
export { surrealql } from "npm:@surrealdb/codemirror@1.0.3";
`;

const entryFile = await Deno.makeTempFile({ suffix: ".ts" });
await Deno.writeTextFile(entryFile, entryContent);

try {
  const result = await esbuild.build({
    plugins: [...denoPlugins()],
    entryPoints: [entryFile],
    bundle: true,
    format: "esm",
    outfile: "static/vendor/codemirror-surrealql.js",
    minify: true,
    sourcemap: false,
    target: "es2020",
  });

  if (result.errors.length > 0) {
    console.error("Build failed:", result.errors);
    Deno.exit(1);
  }

  console.log("✓ Built static/vendor/codemirror-surrealql.js");
} finally {
  await Deno.remove(entryFile);
  await esbuild.stop();
}
