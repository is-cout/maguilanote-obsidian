# FAQ — customizing the project

Practical "where do I go to change X" answers. For the how-things-fit-together view, see [ARCHITECTURE.md](ARCHITECTURE.md).

### How do I change the available card colors?

Edit `CARD_COLORS` in `src/types.ts`. Each entry is `{ key, name, bg, fg }` — `key` is what gets stored in the board file, `bg`/`fg` are the background/text colors shown in the color picker. Add, remove, or restyle entries there; the color picker UI reads this array directly, nothing else needs to change.

### How do I change the default width of a new note?

`DEFAULT_SETTINGS.defaultNoteWidth` in `src/main.ts`. It's also exposed as a plugin setting (Settings → Maguilanote), so users can override it without touching code.

### How do I change the default grid size / snap-to-grid behavior?

`DEFAULT_SETTINGS.gridSnap` and `DEFAULT_SETTINGS.gridSize` in `src/main.ts`. Snap is off by default; holding Ctrl while dragging inverts whichever mode is active.

### How do I add a new card type?

Three places need to agree:

1. `src/types.ts` — add the new tag to the `ItemType` union and any extra fields the `Item` interface needs.
2. `src/render.ts` — add a case to `renderCardFn` that builds the DOM for the new type.
3. `src/board-view.ts` — add a toolbar entry / creation path so users can actually place the new card type on the canvas.

### How do I change which file extensions are treated as images/audio/video?

`IMAGE_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS` in `src/types.ts`. These decide how a dropped vault file is classified into a card (e.g. an image card vs. a generic file card).

### How do I change keyboard shortcuts?

The key handling lives in `src/board-view.ts` (search for the keydown listener). The cheat sheet shown when pressing `/` is `ShortcutsModal` in `src/modals.ts` — update both together so the displayed shortcuts stay accurate.

### How do I change the default templates folder name?

`DEFAULT_SETTINGS.templatesFolder` in `src/main.ts` (default: `"Maguilanote Templates"`). Also a user-facing setting.

### Where is the board file format defined, and is it stable?

`BoardData` / `Item` / `Edge` in `src/types.ts`. `BoardData.version` exists specifically so future format changes can be migrated instead of breaking old boards — bump it and add a migration in `parseBoard` if you change the shape of stored data. Any format change is a "significant change" and must be documented (see the documentation policy in [.claude/CLAUDE.md](../.claude/CLAUDE.md) and logged in [CHANGELOG.md](CHANGELOG.md)).

### Why isn't there real-time collaboration / cloud sync?

Deliberate scope decision, not a gap: the plugin is local-first, one JSON file per board, no server or account. If you want sync, use whatever your vault already uses for that (Obsidian Sync, Git, Syncthing, etc.). See "Why no cloud/collaboration layer" in [ARCHITECTURE.md](ARCHITECTURE.md).

### How do I build without npm?

`node build-local.mjs` (Node 22+, no installed dependencies, no bundler). See [DEVELOPMENT.md](DEVELOPMENT.md).

### Can I bump a dependency version?

Only with explicit approval — versions are pinned on purpose. See [DEPENDENCIES.md](DEPENDENCIES.md).
