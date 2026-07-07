---
applyTo: '**'
---

Docs are a living part of this project, not a one-time deliverable.

## Rule

Every significant change to the project ships its documentation update in the same change — never as a follow-up, never silently skipped.

"Significant" means: new/removed feature, board file format change, dependency change (version bump, new/removed package), settings/defaults change, build process change, or any change a user or contributor would need to know about to not be surprised.

## What to update

1. **[docs/CHANGELOG.md](../../docs/CHANGELOG.md)** — add a dated entry (`YYYY-MM-DD — description. Why. Files touched.`). This is mandatory for every significant change, no exceptions.
2. **[README.md](../../README.md)** — update if the change affects the feature list, installation, usage, or the project description.
3. **[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)** — update if the change affects source layout, data model, or build pipeline.
4. **[docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md)** — update if the change affects how to build, run, or verify the project.
5. **[docs/DEPENDENCIES.md](../../docs/DEPENDENCIES.md)** — update if a dependency is added, removed, or its pinned version changes (see the dependency policy in [CLAUDE.md](../CLAUDE.md)).
6. **[docs/FAQ.md](../../docs/FAQ.md)** — add or update an entry if the change affects a common "how do I customize X" answer (new setting, new card type, new file location for something users tweak).

Not every change touches every doc — but check each one against the list above before calling a task done.

**Why:** stale docs are worse than no docs; they actively mislead. This project's README/docs are meant to be trustworthy enough that a new contributor (or future Claude session) can rely on them instead of re-deriving everything from the source.

**How to apply:** treat "update the docs" as part of the task's definition of done, not an optional nice-to-have. If a change is ambiguous about whether it's "significant," err toward documenting it — a short changelog line costs little.
