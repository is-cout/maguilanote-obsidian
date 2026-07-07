---
name: maguilanote-mount-sync-quirks
description: Sandbox mount truncates in-place edits of files in the Maguilanote project; workarounds
metadata: 
  node_type: memory
  type: project
  originSessionId: e710e195-c00a-4bae-ba10-3a86791c3eb9
---

In the Maguilanote project (Cowork, Windows), the sandbox mount view of files edited in place via Write/Edit gets clamped to the file's OLD byte size: longer content is truncated, shorter content is NUL-padded. The Windows side is always correct. npm registry and CDNs are blocked in the sandbox; builds use Node 22's `stripTypeScriptTypes` via a script in /tmp (see build-local.mjs pattern).

**Why:** builds from truncated sources fail or silently produce broken bundles.

**How to apply:** before building in the sandbox, verify each source file's tail; for stale files, `rm` (needs mcp__cowork__allow_cowork_file_delete once per session) then re-Write, or Write a fresh-named copy (new files sync fully). Strip `\0` when reading sources in the build script. Copy built main.js to the mount from the sandbox side (that direction works), then verify the Windows side with Grep.

`git init`/commit directly on the mount is also flaky (files created via git show as missing right after creation; `git status` on the mount can show stale diffs against files that are actually correct on the Windows side). Workaround: `rsync -a --exclude='.git' <mount>/ /tmp/<name>/`, run `git init`/`add`/`commit` entirely in `/tmp` (sandbox-local, no mount quirks), then `rsync -a /tmp/<name>/.git/ <mount>/.git/` to bring just the `.git` folder back. Always double-check any file touched by Write/Edit that session (not just build artifacts) for NUL-padding/truncation before it goes into that tmp copy — `rsync` from the mount will faithfully copy whatever corruption is currently in the mount's cached view, so verify each edited file against the Read tool (Windows-side ground truth) first, fix via `bytes.rstrip(b'\x00')` for padding or a full rewrite for truncation, then re-add/amend the commit.

Related: [[maguilanote-english-only]], [[maguilanote-dependency-policy]]
