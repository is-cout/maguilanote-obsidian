---
applyTo: '**'
---

# Versioning

This project follows [Semantic Versioning 2.0.0](https://semver.org/). A version is
`MAJOR.MINOR.PATCH`, optionally extended with a pre-release label and/or build metadata.

## What counts as a version-bumping change

**Only changes to the actual plugin bump the version.** The "plugin" is the code and
assets that ship into a vault: `main.js` (built from `src/**`), `manifest.json` (the
user-facing fields), and `styles.css`.

A change bumps the version when it alters any of:

- Plugin behavior, UI, or interactions (`src/**`, `styles.css`).
- The board file format (`Board`/`Card`/`Edge` shape in `src/types.ts`).
- Plugin settings, their defaults, or persisted `data.json` structure.
- `manifest.json` user-facing fields (`description`, `minAppVersion`, `isDesktopOnly`).

A change does **not** bump the version when it only touches non-shipping files:

- `README.md`, `docs/**`, `.claude/**`, instruction/skill files.
- Build tooling, scripts, or dev dependencies that don't change built output
  (`esbuild.config.mjs`, `scripts/**`, `package.json` devDependencies, CI).
- Comments, tests, or repo metadata (`.gitignore`, `LICENSE`).

If a single change mixes plugin code with docs, bump for the plugin part.

## Which number to increment

Given `MAJOR.MINOR.PATCH`, increment:

- **MAJOR** — incompatible changes: a board file written by an older version no longer
  loads or renders correctly, settings/`data.json` migrate in a breaking way, or a
  documented interaction is removed/changed such that a user's muscle memory or existing
  boards break.
- **MINOR** — new functionality, backward-compatible: new card type, new interaction,
  new setting, new optional field in the board format (existing boards still load).
- **PATCH** — backward-compatible bug fixes: correct wrong behavior without changing the
  format or adding features.

When multiple apply in one release, take the highest (a MINOR feature + a PATCH fix -> MINOR).

### Pre-1.0.0 note

While `MAJOR` is `0` (current: `0.1.0`), the API is considered unstable. Breaking changes
are allowed without a `MAJOR` bump: use MINOR for breaking-or-feature changes and PATCH
for fixes. Move to `1.0.0` once the board format and plugin API are declared stable.

## Pre-release and build metadata

SemVer optional extensions:

- Pre-release: `1.2.0-beta.1`, `1.2.0-rc.2` (lower precedence than the release).
- Build metadata: `1.2.0+20260708` (ignored for precedence).

**Obsidian constraint:** `manifest.json` and `versions.json` require a strict `x.y.z`
number — Obsidian rejects pre-release/build labels there. Use these labels only for git
tags / release names (e.g. tag `v1.2.0-rc.1` -> manifest stays `1.2.0` when released).

## Where the version lives (keep in sync)

Every version bump updates all three, to the same `x.y.z`:

1. `package.json` -> `"version"`
2. `manifest.json` -> `"version"`
3. `versions.json` -> add `"x.y.z": "<minAppVersion>"` (maps the new plugin version to the
   minimum Obsidian version it needs). Only add a new entry when `minAppVersion` changes
   or on a notable release; otherwise the newest entry's `minAppVersion` still applies.

## Release procedure

1. Decide MAJOR/MINOR/PATCH from the rules above.
2. Update `package.json`, `manifest.json`, and `versions.json`.
3. Add a `docs/CHANGELOG.md` entry (already required by the living-docs policy).
4. Commit, then tag: `git tag -a v<x.y.z> -m "v<x.y.z>"` and push the tag.

Pushing the tag triggers a GitHub Release automatically — see
[Git Workflow & Commits](git.instructions.md) for commit conventions and the release
automation details.

Do not bump the version speculatively or "while at it" — bump it as part of the plugin
change that earns it, the same way docs ship with their change.
