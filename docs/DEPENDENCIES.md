# Dependency policy

## Rule

All dependency versions in `package.json` are **pinned exactly** (no `^`, no `~`, no ranges). Nobody — human or Claude — installs `@latest`, runs `npm update`, or bumps a version without the project owner explicitly approving it first. This is a hard rule, also codified in [.claude/CLAUDE.md](../.claude/CLAUDE.md).

**Why:** an Obsidian plugin runs inside every user's vault with filesystem access. An unreviewed transitive update (or a compromised package version) is a real supply-chain risk, and silent version drift makes bugs hard to reproduce. Pinning trades a little convenience for reproducibility and an explicit approval step on every change.

**How to apply:** when a new dependency is needed, or an existing one needs a bump (security fix, feature, bug fix), propose the exact version and the reason, and wait for approval before editing `package.json`.

## Current pins (as of 2026-07-07)

| Package | Pinned version | Notes |
|---|---|---|
| `typescript` | `5.4.0` | No known CVEs against the `typescript` package itself. |
| `esbuild` | `0.20.0` | See CVE note below. |
| `obsidian` (types) | `1.4.0` | Type definitions only, matches `minAppVersion` in `manifest.json`. |
| `@types/node` | `20.11.0` | Type definitions only, no known CVEs. |
| `builtin-modules` | `3.3.0` | No known CVEs. |

## Known advisory: esbuild dev server (CVE-2024-23334)

`esbuild` versions before 0.25.0, including the pinned `0.20.0`, have a moderate-severity advisory ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)): esbuild's local **dev server** (`esbuild serve`) doesn't validate the `Origin` header, so any website open in your browser could send requests to it and read responses.

This project's `esbuild.config.mjs` never calls `esbuild.serve()` — both `npm run dev` and `npm run build` only call `context.rebuild()`, so the vulnerable code path is not exercised here. The pin was kept as-is rather than bumped automatically, per the policy above. If you want to bump to `>=0.25.0` anyway (there's no downside for this project's usage), ask first and it'll get a one-line changelog entry.

## Lockfile

`package-lock.json` should be committed once generated with real npm access (this repo was prepared in a sandbox without registry access, so it isn't included yet). Run `npm install` once with network access and commit the resulting lockfile — that's what actually pins transitive dependencies.
