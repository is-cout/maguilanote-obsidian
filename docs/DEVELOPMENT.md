# Development setup

## Prerequisites

- Node.js 22+ (used regardless of which build path below you take).
- An Obsidian vault to test in (desktop).

## Install dependencies

```
npm install
```

This project pins **exact** dependency versions (no `^`/`~` ranges) — see [DEPENDENCIES.md](DEPENDENCIES.md) for why, and the policy on updating them.

## Build

```
npm run build
```

Runs `tsc -noEmit -skipLibCheck` (type-check only, no emit) followed by `esbuild.config.mjs production`, which bundles `src/main.ts` into `main.js` at the project root.

For a watch-style rebuild during development:

```
npm run dev
```

### Without npm

If npm/the registry isn't available in your environment, `build-local.mjs` builds the plugin using only Node's built-in `node:module` `stripTypeScriptTypes` (Node 22+), with no bundler and no installed dependencies:

```
node build-local.mjs
```

Both paths produce `main.js` at the project root. This is a fallback path, not the primary one — prefer `npm run build` when npm is available.

## Load the plugin in Obsidian

Copy `main.js`, `manifest.json` and `styles.css` into `YOUR_VAULT/.obsidian/plugins/maguilanote/`, then enable **Maguilanote** under Settings → Community plugins. Reload the plugin (or restart Obsidian) after each rebuild.

## Verifying a change

There is no automated test suite yet. Before considering a change done:

1. `npm run build` (or `node build-local.mjs`) completes with no type errors.
2. Reload the plugin in a real vault and manually exercise the affected card type/interaction.
3. Check the developer console (Ctrl+Shift+I in Obsidian) for runtime errors.
4. If the change is user-visible or changes a file format, update the relevant doc — see the documentation policy in [.claude/CLAUDE.md](../.claude/CLAUDE.md) and add an entry to [CHANGELOG.md](CHANGELOG.md).
