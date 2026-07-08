# Changelog

Living log of significant changes to the project. This is **not** optional bookkeeping — every significant change (new feature, format change, dependency change, removed feature, policy change) gets an entry here at the time it's made. See the documentation policy in [.claude/CLAUDE.md](../.claude/CLAUDE.md).

Format: `YYYY-MM-DD — short description. Why (if not obvious). Files touched.`

## 2026-07-08

- Added line (arrow/connector) color. Right-click a line -> "Line color" submenu, reuses the same 10-color palette as cards. Stored as `Edge.color` (board file format addition, backward-compatible since it's optional). Files: `src/types.ts`, `src/render.ts`, `src/board-view.ts`.

## 2026-07-07

- Prepared the repo for its first push to GitHub.
  - Added a `.gitignore` (build output, `node_modules`, vault-local `data.json`, OS/editor files, env files).
  - Pinned all `package.json` dependency versions exactly (no `^`/`~` ranges) and documented the update policy — see [DEPENDENCIES.md](DEPENDENCIES.md).
  - Rewrote `README.md`: project description, condensed feature list (previously a separate `FEATURES.md`), explicit "local-first, no cloud collaboration" statement, links into this `docs/` folder.
  - Added `docs/` (`ARCHITECTURE.md`, `DEVELOPMENT.md`, `DEPENDENCIES.md`, `FAQ.md`, this changelog) and a living-documentation policy instruction.
  - No `LICENSE` yet — added manually by the project owner later.
