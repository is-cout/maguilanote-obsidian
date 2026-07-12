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

Runs `tsc -noEmit -skipLibCheck` (type-check only, no emit), then `esbuild.config.mjs production` — which bundles `src/main.ts` into `main.js` **and** bundles `src/styles/index.css` (which `@import`s the partials under `src/styles/`) into the root `styles.css` — then `scripts/copy-to-vault.mjs`. The root `styles.css` is generated; edit the partials under `src/styles/` instead of the root file.

The copy step is optional and local-only: if a `.env.local` file exists at the project root with an `OBSIDIAN_PLUGIN_DIR=<path>` line, `main.js`, `manifest.json` and `styles.css` are copied there automatically after a successful build. `.env.local` is gitignored, so each contributor points it at their own vault; without it, the copy step is a no-op.

For a watch-style rebuild during development:

```
npm run dev
```

### Without npm

If npm/the registry isn't available in your environment, `build-local.mjs` builds the plugin using only Node's built-in `node:module` `stripTypeScriptTypes` (Node 22+), with no bundler and no installed dependencies:

```
node build-local.mjs
```

Both paths produce `main.js` at the project root. This is a fallback path, not the primary one — prefer `npm run build` when npm is available. It concatenates `src/*.ts` in dependency order (see the file list at the top of `build-local.mjs`) and does not bundle `styles.css` — if you use this path, build CSS separately (e.g. `npx esbuild src/styles/index.css --bundle --outfile=styles.css`) or copy an existing `styles.css`.

## Load the plugin in Obsidian

Copy `main.js`, `manifest.json` and `styles.css` into `YOUR_VAULT/.obsidian/plugins/maguilanote/`, then enable **Maguilanote** under Settings → Community plugins. Reload the plugin (or restart Obsidian) after each rebuild. (Set up `.env.local` as described above to have `npm run build` do this copy automatically.)

## Verifying a change

There is no automated test suite yet. Before considering a change done:

1. `npm run build` (or `node build-local.mjs`) completes with no type errors.
2. Reload the plugin in a real vault and manually exercise the affected card type/interaction.
3. Check the developer console (Ctrl+Shift+I in Obsidian) for runtime errors.
4. If the change is user-visible or changes a file format, update the relevant doc — see the documentation policy in [.claude/CLAUDE.md](../.claude/CLAUDE.md) and add an entry to [CHANGELOG.md](CHANGELOG.md).
