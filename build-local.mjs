// Fallback bundler: transpiles src/*.ts to a single main.js using Node's
// built-in TypeScript type-stripping (no npm dependencies required).
// Usage: node build-local.mjs   (or use `npm run build` if you have deps installed)
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const files = ["src/types.ts", "src/modals.ts", "src/render.ts", "src/board-view.ts", "src/main.ts"];
const obsidianImports = new Set();
const chunks = [];

for (const f of files) {
  const code = readFileSync(f, "utf8");
  let js = stripTypeScriptTypes(code, { mode: "transform", sourceMap: false });
  js = js.replace(/import\s*\{([^}]*)\}\s*from\s*["']obsidian["'];?/g, (_m, names) => {
    names
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((n) => obsidianImports.add(n));
    return "";
  });
  js = js.replace(/import[^;]*?from\s*["']\.[^"']*["'];?/g, "");
  js = js.replace(/^\s*export\s+default\s+/m, "");
  js = js.replace(/^export\s+/gm, "");
  chunks.push(`// ---- ${f} ----\n${js}`);
}

const header =
  `"use strict";\n` +
  `const { ${[...obsidianImports].sort().join(", ")} } = require("obsidian");\n\n`;
const footer =
  `\nmodule.exports = MaguilanotePlugin;\n` +
  `module.exports.default = MaguilanotePlugin;\n`;

writeFileSync("main.js", header + chunks.join("\n\n") + footer);
console.log("main.js written (" + (header.length + footer.length + chunks.join("").length) + " bytes)");
