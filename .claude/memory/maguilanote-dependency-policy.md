---
name: maguilanote-dependency-policy
description: "Maguilanote: dependencies are always pinned exactly, never @latest or auto-updated"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8180bce5-51a4-4667-a870-0abf3e3bed75
---

In the Maguilanote project, all `package.json` dependency versions must be pinned exactly (no `^`/`~` ranges). Never install `@latest`, never run an automatic update, never bump a version — even a patch/security fix — without asking Lucas first and getting explicit approval. This is codified directly in the project's `.claude/CLAUDE.md` ("Dependency Policy" section) and in `docs/DEPENDENCIES.md`, added 2026-07-07 when preparing the repo for its first GitHub push.

**Why:** an Obsidian plugin runs with filesystem access inside every user's vault; unreviewed dependency drift (or a compromised package version) is a real supply-chain risk, and Lucas wants an explicit approval step on every version change, not silent convenience updates.

**How to apply:** if a dependency needs a version bump for any reason (new feature, bug fix, CVE), propose the exact version and the reason, and wait for approval before editing `package.json`. This applies project-wide, not just to the initial pin.

Related: [[maguilanote-english-only]], [[maguilanote-mount-sync-quirks]]
