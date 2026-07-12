---
applyTo: '**'
---

# Git Workflow & Commits

## Branching (Git Flow)

- `main` — always releasable, reflects the latest released version. Only receives merges
  from a `release/*` (or `hotfix/*`) branch. Every merge into `main` is tagged `x.y.z`
  (bare numbers, no `v` prefix).
- `develop` — integration branch. All `feature/*` and `fix/*` branches merge here first.
- `feature/<short-name>` — new functionality. Branch off `develop`, merge back into `develop`.
- `fix/<short-name>` — bug fixes. Branch off `develop`, merge back into `develop`.
- `chore/<short-name>` — tooling, docs, deps, non-plugin work. Branch off `develop`.
- `release/<x.y.z>` — cut from `develop` to prepare a release. Last-minute fixes happen here
  (the version bump and changelog entry already happened on the `feature`/`fix` branch that
  earned them, per [Versioning](versioning.instructions.md)). Merges into both `main` and
  `develop`, then gets tagged. This is the trigger point for the `release` skill (see Release
  below).
- `hotfix/<x.y.z>` — urgent fix cut directly from `main` for an already-released version.
  Merges into both `main` and `develop`, then gets tagged, same as a release branch.

Releases are **requested, not automatic** — a version bump or a merge to `develop` does not
by itself create a release. A release only happens when explicitly asked for (see below).

## Committing After a Task

Once a requested code change is implemented, verified (typecheck/build), and its docs are
updated, commit it without waiting for a separate "commit this" prompt: create (or reuse, if
one is already open for this task) the `feature/*`/`fix/*`/`chore/*` branch off `develop` and
commit there. This is a standing instruction — it overrides the general "never commit unless
explicitly asked" default for this project.

**Do not merge the branch into `develop`, delete it, or push anything, unless Lucas explicitly
says the feature/fix is done** (e.g. "fecha essa branch", "merge isso", "pode fechar") — same
rule as releases: a branch may stay open across several commits while he tests it, tries more
changes, or comes back to it later. Committing is automatic; closing (merge + branch deletion)
and pushing are not.

## Commit Messages (Conventional Commits)

Format: `<type>: <short summary>`

Types:

- `feat:` — new feature or capability.
- `fix:` — bug fix.
- `docs:` — documentation only (README, docs/, instructions/).
- `chore:` — tooling, build config, deps, repo maintenance.
- `refactor:` — code change that neither fixes a bug nor adds a feature.
- `style:` — formatting only, no code meaning change.
- `test:` — adding or fixing tests.
- `ci:` — CI/CD workflow changes.

Rules:

- Summary in imperative mood, lowercase after the colon, no trailing period.
- Keep commits small and scoped to one logical change.
- Body (optional) explains *why*, not *what* — the diff already shows what.
- No Claude/AI co-author trailer in commit messages.

Examples:

```
feat: add sticky note color picker
fix: mic dropdown width mismatch with font dropdown
docs: update changelog for v0.7.1
chore: pin esbuild to 0.28.1
```

## Release Procedure

Releases are **user-requested**, not automatic. When Lucas asks for a release, use the
`release` skill (`.claude/skills/release/`) instead of doing these steps ad hoc — it
encodes the full sequence below.

Follows [Versioning](versioning.instructions.md) for what bumps the version and which files to sync.

The version in `package.json`/`manifest.json`/`versions.json` is already current on `develop`
by this point — each `feat`/`fix` bumped it when it shipped (see
[Versioning](versioning.instructions.md)). This procedure just cuts, tags, and publishes it.

1. Cut `release/<x.y.z>` from `develop`, `x.y.z` matching the version already on `develop`.
2. Apply any last-minute fixes on the release branch (bump further only if a fix itself earns it).
3. Confirm `docs/CHANGELOG.md` reflects everything in the release.
4. Commit on the release branch if step 2/3 changed anything (e.g. `chore: release v0.7.2`).
5. Merge `release/<x.y.z>` into `main`.
6. Tag on `main`: `git tag -a <x.y.z> -m "<x.y.z>"`. **No `v` prefix** — Obsidian requires the
   release tag to match `manifest.json`'s `version` exactly, or the plugin won't install.
7. Merge `release/<x.y.z>` back into `develop` (keeps any release-branch fixes).
8. Push `main`, `develop`, and the tag: `git push origin main develop <x.y.z>`.
9. Delete the `release/<x.y.z>` branch.

Pushing the `x.y.z` tag triggers the `.github/workflows/release.yml` GitHub Action, which builds the plugin and publishes a GitHub Release containing only `main.js`, `manifest.json`, and `styles.css` (the files a user drops into their vault's plugin folder).
