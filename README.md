# Maguilanote

A Milanote-style visual workspace for [Obsidian](https://obsidian.md): notes, images, links, files, columns, to-do lists, color swatches, comments, nested boards and arrows on an infinite canvas — entirely inside your vault.

**Local-first by design.** Each board is a single `.board` JSON file in your vault. There's no account, no server, and no real-time collaboration — sync your vault however you already do (Obsidian Sync, Git, Syncthing, a shared folder...). Cloud collaboration is out of scope for this project, not a missing feature.

## Features

Legend: ✅ implemented · 🔜 roadmap · ❌ out of scope

**Boards & organization**
- Infinite canvas with pan/zoom ✅
- Nested boards with clickable breadcrumb ✅
- Board-to-board shortcuts ✅
- Broken-reference detection & re-linking ✅
- Content preview on board cards ✅
- Lock an item ✅
- Move/duplicate content across boards ✅
- Built-in + custom templates ✅
- Unsorted-notes inbox 🔜
- Trash with restore 🔜 (undo/redo covers this for now)

**Card types**
- Text note (Markdown) ✅
- Image via drag & drop ✅
- Link card with auto-fetched title & YouTube embeds ✅
- File card (any type, with audio/video players) ✅
- Vault file drag & drop (`.board` files become nested boards) ✅
- To-do list with progress bar ✅
- Column (stack cards vertically, collapsible) ✅
- Color swatch with live picker ✅
- Comment card ✅
- Document card (linked vault `.md` note, inline preview) ✅
- Draw/annotate on image 🔜
- Color palette from image 🔜
- Table with formulas 🔜
- Freehand sketch 🔜
- Synced notes across boards 🔜
- Map card ❌ (external API)

**Connections & diagrams**
- Arrows between cards ✅
- Solid/dashed lines, with/without arrowhead, reversible ✅
- Labels on arrows ✅
- Standalone divider line 🔜

**Text editing**
- Headings/bold/italic/strikethrough, lists, quotes, code blocks, inline links, `[[wikilinks]]` ✅ (it's Markdown)
- Card background colors ✅

**Canvas interaction**
- Click selects/drag moves, inert until selected ✅
- Multi-select (rubber band + Shift) ✅
- Group move ✅
- Resize (horizontal + vertical, never clips text) ✅
- Alt+drag duplicate ✅
- Snap-to-grid toggle (Ctrl inverts) ✅
- Undo/redo ✅
- Cut/copy/paste across boards ✅
- Keyboard shortcuts cheat sheet (`/`) ✅
- Zoom in/out, 100%, fit ✅

**Search & export**
- In-board search (Ctrl+F) ✅, global search 🔜
- Export to Markdown ✅, PDF/PNG export 🔜
- Word count 🔜
- Import from OS or vault file explorer ✅
- Web clipper ❌ (use Obsidian's own Web Clipper and paste the link)

**Collaboration & cloud (out of scope)**
- Real-time multi-user editing ❌
- Public share links ❌
- Mentions/notifications ❌ (local comment cards ✅)
- Presentation/read-only mode 🔜
- Unlimited local storage ✅ (it's your disk)

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
