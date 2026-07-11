// Fallback bundler: transpiles src/*.ts to a single main.js using Node's
// built-in TypeScript type-stripping (no npm dependencies required).
// Usage: node build-local.mjs   (or use `npm run build` if you have deps installed)
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

// dependency order: each file's local imports must already be defined by an
// earlier chunk once everything is flattened into one scope
const files = [
  "src/types.ts",
  "src/secrets.ts",
  "src/settings-ui.ts",
  "src/draw.ts",
  "src/modals.ts",
  "src/render.ts",
  "src/geometry.ts",
  "src/board-history.ts",
  "src/board-camera.ts",
  "src/board-interaction.ts",
  "src/board-item-crud.ts",
  "src/board-clipboard.ts",
  "src/board-context-menu.ts",
  "src/board-keyboard.ts",
  "src/board-drop-import.ts",
  "src/drawing-toolbar.ts",
  "src/record-card.ts",
  "src/file-preview.ts",
  "src/board-search.ts",
  "src/board-view.ts",
  "src/main.ts",
];
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
  // named imports from a local module may rename a symbol (`x as y`); once
  // flattened into one scope those bindings still need to exist, so keep
  // them as `const y = x;` instead of dropping the whole line
  js = js.replace(/import\s*\{([^}]*)\}\s*from\s*["']\.[^"']*["'];?/g, (_m, names) =>
    names
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const asMatch = entry.match(/^(\S+)\s+as\s+(\S+)$/);
        return asMatch ? `const ${asMatch[2]} = ${asMatch[1]};` : null;
      })
      .filter(Boolean)
      .join("\n")
  );
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
