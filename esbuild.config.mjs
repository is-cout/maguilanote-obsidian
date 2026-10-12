import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2020",
  // Lower import() to require(): Obsidian loads plugins as CommonJS, and Node
  // builtins (src/secrets.ts) only resolve through require().
  supported: { "dynamic-import": false },
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

const cssContext = await esbuild.context({
  entryPoints: ["src/styles/index.css"],
  bundle: true,
  outfile: "styles.css",
  logLevel: "info",
});

if (prod) {
  await context.rebuild();
  await cssContext.rebuild();
  process.exit(0);
} else {
  await context.rebuild();
  await cssContext.rebuild();
  process.exit(0);
}
