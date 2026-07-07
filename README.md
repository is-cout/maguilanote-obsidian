# Maguilanote

A Milanote-style visual workspace for [Obsidian](https://obsidian.md): notes, images, links, files, columns, to-do lists, color swatches, comments, nested boards and arrows on an infinite canvas — entirely inside your vault.

**Local-first by design.** Each board is a single `.board` JSON file in your vault. There's no account, no server, and no real-time collaboration — sync your vault however you already do (Obsidian Sync, Git, Syncthing, a shared folder...). Cloud collaboration is out of scope for this project, not a missing feature.

## Features

Legend: ✅ implemented · 🔜 roadmap · ❌ out of scope

**Boards & organization** — infinite canvas with pan/zoom ✅ · nested boards with clickable breadcrumb ✅ · board-to-board shortcuts ✅ · broken-reference detection & re-linking ✅ · content preview on board cards ✅ · lock an item ✅ · move/duplicate content across boards ✅ · built-in + custom templates ✅ · unsorted-notes inbox 🔜 · trash with restore 🔜 (undo/redo covers this for now).

**Card types** — text note (Markdown) ✅ · image via drag & drop ✅ · link card with auto-fetched title & YouTube embeds ✅ · file card (any type, with audio/video players) ✅ · vault file drag & drop (`.board` files become nested boards) ✅ · to-do list with progress bar ✅ · column (stack cards vertically, collapsible) ✅ · color swatch with live picker ✅ · comment card ✅ · document card (linked vault `.md` note, inline preview) ✅ · draw/annotate on image 🔜 · color palette from image 🔜 · table with formulas 🔜 · freehand sketch 🔜 · synced notes across boards 🔜 · map card ❌ (external API).

**Connections & diagrams** — arrows between cards ✅ · solid/dashed lines, with/without arrowhead, reversible ✅ · labels on arrows ✅ · standalone divider line 🔜.

**Text editing** — headings/bold/italic/strikethrough, lists, quotes, code blocks, inline links, `[[wikilinks]]` ✅ (it's Markdown) · card background colors ✅.

**Canvas interaction** — click selects/drag moves, inert until selected ✅ · multi-select (rubber band + Shift) ✅ · group move ✅ · resize (horizontal + vertical, never clips text) ✅ · Alt+drag duplicate ✅ · snap-to-grid toggle (Ctrl inverts) ✅ · undo/redo ✅ · cut/copy/paste across boards ✅ · keyboard shortcuts cheat sheet (`/`) ✅ · zoom in/out, 100%, fit ✅.

**Search & export** — in-board search (Ctrl+F) ✅, global search 🔜 · export to Markdown ✅, PDF/PNG export 🔜 · word count 🔜 · import from OS or vault file explorer ✅ · web clipper ❌ (use Obsidian's own Web Clipper and paste the link).

**Collaboration & cloud (out of scope)** — real-time multi-user editing ❌ · public share links ❌ · mentions/notifications ❌ (local comment cards ✅) · presentation/read-only mode 🔜 · unlimited local storage ✅ (it's your disk).

## Manual installation

1. Copy `main.js`, `manifest.json` and `styles.css` to `YOUR_VAULT/.obsidian/plugins/maguilanote/`.
2. In Obsidian → Settings → Community plugins, enable **Maguilanote**.

## Usage

- The ribbon icon or the **"Maguilanote: New board"** command creates a `.board` file.
- Double-click the canvas to create a note. The left toolbar adds every other card type — click it, or drag it onto the canvas.
- Click a card to select it; drag to move. Inputs inside a card only activate once it is selected. Double-click to edit/open.
- Drag files from the OS or from Obsidian's file explorer straight onto the board (`.board` files become nested boards).
- Alt+drag duplicates. The bottom bar has zoom controls, 1:1, fit, and a snap-to-grid toggle (Ctrl while dragging inverts snap).
- Press `/` inside a board to see all shortcuts.

## Building from source

With npm available:

```
npm install
npm run build
```

Without npm (Node 22+ only):

```
node build-local.mjs
```

Both produce `main.js` at the project root. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for details.

## Documentation

This README covers the essentials. For everything else, see [`docs/`](docs/):

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the plugin is built: source layout, data model, rendering and build pipeline.
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — full dev setup, build commands, verification checklist.
- [DEPENDENCIES.md](docs/DEPENDENCIES.md) — dependency pinning policy and current versions.
- [FAQ.md](docs/FAQ.md) — "how do I change X" answers (colors, defaults, card types, shortcuts, and more).
- [CHANGELOG.md](docs/CHANGELOG.md) — living log of significant project changes.

Docs are a living part of this project: significant changes must update the relevant doc and get a changelog entry in the same change, not as a follow-up. See the documentation policy in [.claude/CLAUDE.md](.claude/CLAUDE.md).
