/**
 * Builds a vendor bundle for CodeMirror with SurrealDB syntax highlighting
 * and autocompletion support.
 *
 * Run with: deno run -A scripts/build-codemirror.ts
 */

import * as esbuild from "npm:esbuild@0.24.0";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.11.0";

// Load completions data
const completions = JSON.parse(
  await Deno.readTextFile("scripts/surql-completions.json")
);

// Transform tables object to the format needed by completion source
const tableNames = Object.keys(completions.tables);
const tableFields = completions.tables;

const completionData = {
  keywords: completions.keywords || [],
  functions: completions.functions || [],
  types: completions.types || [],
  tables: tableNames,
  tableFields: tableFields,
};

// Create entry file with completions embedded
const entryContent = `
export { basicSetup, EditorView } from "npm:codemirror@6.0.1";
export { json } from "npm:@codemirror/lang-json@6.0.1";
export { surrealql } from "npm:@surrealdb/codemirror@1.0.3";
export { autocompletion } from "npm:@codemirror/autocomplete@6.18.0";

// Generated completion data
const surqlCompletions = ${JSON.stringify(completionData)};

/**
 * Custom completion source for SurrealQL.
 * Provides context-aware completions for keywords, tables, and fields.
 */
export function surqlCompletionSource(context) {
  const word = context.matchBefore(/[\\w:.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const textBefore = context.state.doc.sliceString(0, context.pos);
  const lineStart = textBefore.lastIndexOf("\\n") + 1;
  const lineBefore = textBefore.slice(lineStart, context.pos).toUpperCase();

  // Check if we're after a table reference (e.g., "user.")
  const dotMatch = word.text.match(/^(\\w+)\\./);
  if (dotMatch) {
    const tableName = dotMatch[1];
    const fields = surqlCompletions.tableFields[tableName] || [];
    if (fields.length > 0) {
      return {
        from: word.from + tableName.length + 1,
        options: fields.map(f => ({ label: f, type: "property" })),
      };
    }
  }

  // Check context for table suggestions (after FROM, INTO, UPDATE, etc.)
  const tableContexts = ["FROM", "INTO", "UPDATE", "DELETE", "CREATE", "TABLE", "ON"];
  const shouldSuggestTables = tableContexts.some(kw => {
    const regex = new RegExp(kw + "\\\\s+$", "i");
    return regex.test(lineBefore);
  });

  if (shouldSuggestTables) {
    return {
      from: word.from,
      options: surqlCompletions.tables.map(t => ({ label: t, type: "class" })),
    };
  }

  // Default: suggest everything relevant
  const options = [
    ...surqlCompletions.keywords.map(k => ({ label: k, type: "keyword" })),
    ...surqlCompletions.tables.map(t => ({ label: t, type: "class" })),
    ...surqlCompletions.functions.map(f => ({ label: f, type: "function" })),
    ...surqlCompletions.types.map(t => ({ label: t, type: "type" })),
  ];

  return {
    from: word.from,
    options,
    validFor: /^[\\w:.]*$/,
  };
}
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
  console.log(`  - ${completionData.tables.length} tables`);
  console.log(`  - ${completionData.keywords.length} keywords`);
  console.log(`  - ${completionData.functions.length} functions`);
  console.log(`  - ${completionData.types.length} types`);
} finally {
  await Deno.remove(entryFile);
  await esbuild.stop();
}
