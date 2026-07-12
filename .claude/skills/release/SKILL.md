---
name: release
description: Cut and ship a plugin release using Git Flow — creates a release branch off develop, bumps the version, merges into main and develop, tags, and pushes to trigger the GitHub release build. Use when Lucas explicitly asks for a release (e.g. "faz uma release", "cut a release", "ship v0.8.0").
---

# Release

Ships a new plugin version following this repo's Git Flow. Read
[.claude/instructions/git.instructions.md](../../instructions/git.instructions.md) and
[.claude/instructions/versioning.instructions.md](../../instructions/versioning.instructions.md)
first — this skill is the executable form of the "Release Procedure" section in both.

Only run this when the user explicitly asks for a release. A version bump or a merge to
`develop` alone is never a trigger.

## Steps

1. **Confirm working tree is clean and on `develop`.**
   `git status` must be clean. If not on `develop`, ask before switching — don't discard
   uncommitted work.

2. **Determine the version.**
   Ask the user for `x.y.z` if not given, or derive it from
   [Versioning](../../instructions/versioning.instructions.md) rules by reviewing commits
   since the last tag (`git log <last-tag>..develop`). State the reasoning (MAJOR/MINOR/PATCH)
   before proceeding.

3. **Cut the release branch.**
   ```
   git checkout -b release/<x.y.z> develop
   ```

4. **Bump version files to the same `x.y.z`:**
   - `package.json` -> `"version"`
   - `manifest.json` -> `"version"`
   - `versions.json` -> add `"x.y.z": "<minAppVersion>"` if `minAppVersion` changed

5. **Update `docs/CHANGELOG.md`** with an entry for this version, summarizing the changes
   since the last release (use `git log <last-tag>..develop --oneline` for source material).

6. **Commit on the release branch:**
   ```
   git add package.json manifest.json versions.json docs/CHANGELOG.md
   git commit -m "chore: release <x.y.z>"
   ```

7. **Merge into `main`:**
   ```
   git checkout main
   git merge --no-ff release/<x.y.z>
   ```

8. **Tag on `main`** — bare `x.y.z`, **never** a `v` prefix (Obsidian requires the release
   tag to match `manifest.json`'s `version` exactly; the release workflow only triggers on
   `[0-9]+.[0-9]+.[0-9]+`):
   ```
   git tag -a <x.y.z> -m "<x.y.z>"
   ```

9. **Merge back into `develop`:**
   ```
   git checkout develop
   git merge --no-ff release/<x.y.z>
   ```

10. **Confirm with the user before pushing** (pushing triggers the public GitHub release
    build — this is the irreversible, visible step). Show what will be pushed:
    `main`, `develop`, and tag `<x.y.z>`.

11. **Push:**
    ```
    git push origin main develop <x.y.z>
    ```

12. **Delete the release branch** (local and remote if it was pushed):
    ```
    git branch -d release/<x.y.z>
    ```

13. Report the release: tag pushed, and that
    [.github/workflows/release.yml](../../../.github/workflows/release.yml) will build and
    publish the GitHub Release with `main.js`, `manifest.json`, `styles.css`. Link the
    Actions run if available (`gh run list --workflow=release.yml -L 1`).

## Notes

- This is a hard-to-reverse, publicly-visible action (pushes to shared branches, creates a
  public GitHub Release). Always confirm the version number and changelog with the user
  before step 11, per this repo's risk-confirmation policy.
- If `develop` doesn't exist yet in the repo, ask the user whether to create it from `main`
  before proceeding — don't invent branch topology silently.
- For an urgent fix to an already-released version, use `hotfix/<x.y.z>` cut from `main`
  instead of `release/<x.y.z>` cut from `develop`; the rest of the steps (bump, changelog,
  merge into `main` and `develop`, tag, push) are the same.
