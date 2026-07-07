# Architecture

Technical overview of how the Maguilanote plugin is built. Read this before making non-trivial changes.

## Overview

Maguilanote is an [Obsidian](https://obsidian.md) plugin that registers a custom file type, `.board`, and renders it as an infinite canvas instead of Markdown text. Each `.board` file is a plain JSON document. There is no server, no account, and no sync layer of its own — persistence is just "write JSON to a vault file," so it works with whatever sync method the vault already uses (Obsidian Sync, Git, Syncthing, a shared folder, etc.).

## Source layout

| File | Responsibility |
|---|---|
| `src/main.ts` | Plugin entry point. Registers the `.board` extension and the `BoardView`, adds ribbon icon/commands (new board, export to Markdown), owns plugin settings (grid snap, grid size, default note width, templates folder) and the cross-board clipboard. |
| `src/types.ts` | Shared data model: `Item`, `Edge`, `BoardData`, card color palette (`CARD_COLORS`), file-extension lists used to classify dropped files, and `parseBoard` (JSON → `BoardData`, tolerant of malformed/empty files). |
| `src/board-view.ts` | The largest module. Implements `BoardView extends TextFileView` — canvas pan/zoom, selection, drag/resize, keyboard shortcuts, undo/redo, cut/copy/paste, drag & drop from the OS and from Obsidian's file explorer, arrow/edge drawing, and read/write of the underlying `.board` file. |
| `src/render.ts` | Pure(ish) rendering helpers: builds the DOM for each card type (note, image, link, file, column, todo, swatch, comment, board) and draws SVG edges between cards. Kept separate from `board-view.ts` so card markup doesn't get tangled with interaction/state logic. |
| `src/modals.ts` | Small reusable Obsidian modals: text prompt, vault file picker, keyboard-shortcuts cheat sheet. |

## Data model

A board file is:

```jsonc
{
  "version": 1,
  "items": [ /* Item[] — notes, images, links, files, columns, todos, swatches, comments, nested boards */ ],
  "edges": [ /* Edge[] — arrows/lines between item ids */ ]
}
```

`Item.type` is one of: `note`, `image`, `link`, `file`, `column`, `todo`, `swatch`, `comment`, `board` (see `ItemType` in `src/types.ts`). Every item has a position (`x`, `y`), width (`w`) and optional manual height (`h`); content that grows taller than `h` is never clipped. Items can be nested inside a `column` item via `parent` + `order`.

Nested boards are just `board`-type items whose `path` points at another `.board` file in the vault — there's no separate "project" concept, a board **is** the file.

## Rendering pipeline

1. `BoardView.onLoadFile` reads the file, calls `parseBoard`, stores `BoardData` in memory.
2. For each item, `render.ts`'s `renderCardFn` builds the card DOM based on `item.type`.
3. `drawEdgesFn` draws an SVG overlay for arrows/lines, positioned relative to the current pan/zoom transform.
4. User interactions (drag, resize, edit) mutate the in-memory `BoardData`, then `BoardView` schedules a save (`TextFileView.requestSave`), which serializes back to JSON.

## Build pipeline

- TypeScript (`tsconfig.json`) type-checks `src/**/*.ts` (`tsc -noEmit`) — no `.js` is emitted by `tsc` itself.
- [esbuild](https://esbuild.github.io/) (`esbuild.config.mjs`) bundles `src/main.ts` into a single CommonJS `main.js`, externalizing `obsidian`, `electron`, CodeMirror/Lezer packages (provided by the Obsidian host at runtime) and Node builtins.
- `manifest.json` + `versions.json` follow the standard Obsidian plugin conventions (`minAppVersion` compatibility map).

See [DEVELOPMENT.md](DEVELOPMENT.md) for how to actually run the build.

## Why no cloud/collaboration layer

This is a deliberate scope decision, not a missing feature: the plugin is local-first by design. All state lives in a single JSON file inside the user's own vault. Real-time multi-user editing, hosted sharing links, and account-based sync are explicitly out of scope — see the "Collaboration & cloud" section in the README's feature list.
