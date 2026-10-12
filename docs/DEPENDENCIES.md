# Dependency policy

## Rule

All dependency versions in `package.json` are **pinned exactly** (no `^`, no `~`, no ranges). Nobody — human or Claude — installs `@latest`, runs `npm update`, or bumps a version without the project owner explicitly approving it first. This is a hard rule, also codified in [.claude/CLAUDE.md](../.claude/CLAUDE.md).

**Why:** an Obsidian plugin runs inside every user's vault with filesystem access. An unreviewed transitive update (or a compromised package version) is a real supply-chain risk, and silent version drift makes bugs hard to reproduce. Pinning trades a little convenience for reproducibility and an explicit approval step on every change.

**How to apply:** when a new dependency is needed, or an existing one needs a bump (security fix, feature, bug fix), propose the exact version and the reason, and wait for approval before editing `package.json`.

## Current pins (as of 2026-10-12)

**Runtime dependency** (bundled into `main.js`):

| Package | Pinned version | Notes |
|---|---|---|
| `perfect-freehand` | `1.2.3` | Turns freehand pointer input (incl. pen pressure) into smooth stroke outlines for the Draw/Sketch feature. Zero-dependency, ~4KB; bundled by esbuild (not in `external`). |

**Dev dependencies** (type-checking / bundling / linting only):

| Package | Pinned version | Notes |
|---|---|---|
| `typescript` | `5.4.2` | No known CVEs against the `typescript` package itself. |
| `esbuild` | `0.28.1` | See CVE note below. |
| `obsidian` (types) | `1.8.7` | Type definitions only. Bumped from `1.4.0` because `eslint-plugin-obsidianmd` requires exactly `1.8.7` as a peer. `minAppVersion` is `1.6.6`, so the types expose APIs newer than the minimum supported app — check an API's `@since` (or that it exists in the `1.6.6` types) before using it. Its `moment` dependency has a moderate advisory (GHSA-4p3w-j4w9-5jqw); types only, never bundled. |
| `@types/node` | `20.11.0` | Type definitions only, no known CVEs. |
| `eslint` | `9.39.5` | Linter. 9.x because the Obsidian plugin peers on `@eslint/js` `^9`; npm marks it deprecated (9.x out of support) — move to 10.x once the plugin supports it. |
| `@eslint/js` | `9.39.5` | Peer of `eslint-plugin-obsidianmd`. |
| `@eslint/json` | `0.14.0` | Peer of `eslint-plugin-obsidianmd` (exact pin required). |
| `typescript-eslint` | `8.70.1` | Type-checked lint rules; peer of `eslint-plugin-obsidianmd`. |
| `eslint-plugin-obsidianmd` | `0.4.2` | Obsidian's official lint rules — the same TS checks the community plugin scorecard runs. |

## Known advisory: esbuild dev server (CVE-2024-23334)

`esbuild` versions before 0.25.0 have a moderate-severity advisory ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)): esbuild's local **dev server** (`esbuild serve`) doesn't validate the `Origin` header, so any website open in your browser could send requests to it and read responses.

The pinned version (`0.28.1`) is already >=0.25.0, so this advisory does not apply. This project's `esbuild.config.mjs` also never calls `esbuild.serve()` — both `npm run dev` and `npm run build` only call `context.rebuild()` — so the vulnerable code path was never exercised here regardless.

## Lockfile

`package-lock.json` should be committed once generated with real npm access (this repo was prepared in a sandbox without registry access, so it isn't included yet). Run `npm install` once with network access and commit the resulting lockfile — that's what actually pins transitive dependencies.
