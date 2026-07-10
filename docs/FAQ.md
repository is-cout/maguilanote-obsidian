# FAQ — customizing the project

Practical "where do I go to change X" answers. For the how-things-fit-together view, see [ARCHITECTURE.md](ARCHITECTURE.md).

### How do I change the available card colors?

Edit `CARD_COLORS` in `src/types.ts`. Each entry is `{ key, name, bg, fg }` — `key` is what gets stored in the board file, `bg`/`fg` are the background/text colors shown in the color picker (`bg`/`fg` can be a plain hex or a `var(--...)` CSS variable, like the `"default"` entry does to stay theme-adaptive). Add, remove, or restyle entries there; the color picker UI reads this array directly, nothing else needs to change. If you remove a `key` that might already be stored in existing boards, add an alias for it in `LEGACY_COLOR_ALIASES` (same file) so old boards keep resolving to a valid color instead of silently falling back to index 0.

### How do I change the default width of a new note?

`DEFAULT_SETTINGS.defaultNoteWidth` in `src/main.ts`. It's also exposed as a plugin setting (Settings → Maguilanote), so users can override it without touching code.

### How do I change the default grid size / snap-to-grid behavior?

`DEFAULT_SETTINGS.gridSnap` and `DEFAULT_SETTINGS.gridSize` in `src/main.ts`. Snap is off by default; holding Ctrl while dragging inverts whichever mode is active.

### How do I add a new card type?

Three places need to agree:

1. `src/types.ts` — add the new tag to the `ItemType` union and any extra fields the `Item` interface needs.
2. `src/render.ts` — add a case to `renderCardFn` that builds the DOM for the new type.
3. `src/board-view.ts` — add a toolbar entry / creation path so users can actually place the new card type on the canvas.

### How do I tune drawing (stroke defaults, how strokes group into drawings)?

All three knobs are constants at the top of `src/types.ts`:

- `DRAW_GROUP_DISTANCE` — the max gap (px) between strokes for them to be clustered into one `drawing` item when you save a board drawing. Bigger = fewer, larger drawings; smaller = more, tighter ones.
- `DEFAULT_STROKE_COLOR` and `DEFAULT_STROKE_SIZE` — the pen color/width a new draw or sketch session starts with (both changeable live in the contextual toolbar).

The stroke *look* (smoothing/thinning/pressure response) is in `strokeToPath` in `src/draw.ts`, which wraps `perfect-freehand`'s `getStroke` options.

### How do I change the default microphone for Record cards?

`DEFAULT_SETTINGS.defaultMicId` in `src/main.ts` (default: `""`, meaning system default). Also a user-facing setting (gear icon → Settings → Recording), populated from `navigator.mediaDevices.enumerateDevices()`; it only pre-selects the mic in a Record card's popup, users can still switch mic there per-recording.

### How do I change which file extensions are treated as images/audio/video?

`IMAGE_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS` in `src/types.ts`. These decide how a dropped vault file is classified into a card (e.g. an image card vs. a generic file card).

### How do I change keyboard shortcuts?

Users rebind keyboard shortcuts themselves: gear icon next to the breadcrumb trail → **Settings** → **Shortcuts**. Bindings are stored in `MaguilanoteSettings.keybindings` (`src/main.ts`), keyed by `ShortcutActionId`. To add a new rebindable action: add the id to `ShortcutActionId`, its label to `SHORTCUT_LABELS`, and its default to `DEFAULT_KEYBINDINGS` (all in `src/types.ts`), then check `matchesBinding(e, kb.<id>)` in `onKeyDown` in `src/board-view.ts`. Mouse/gesture-only shortcuts (not key-based) are the static `MOUSE_SHORTCUTS` reference table in `src/modals.ts` (`SettingsModal`).

### How do I change font / theme / color defaults?

`DEFAULT_SETTINGS.fontFamily` and `.theme` (`"dark" | "light"`) in `src/main.ts` — both exposed as user settings (gear icon → Settings → Customization). The board/card colors themselves live in `DEFAULT_THEME_COLORS` (`src/types.ts`), one `ThemeColors` object per theme (`canvasBg`, `cardDefaultBg`, and the 8 named card colors); users can override any of them per-theme from the same Customization section, stored in `settings.colors.light` / `settings.colors.dark`. `BoardView.applyAppearance()` (`src/board-view.ts`) writes the active theme's values onto the corresponding `--mgn-canvas-bg` / `--mgn-card-default-bg` / `--mgn-card-color-*` CSS variables, and toggles the `.mgn-theme-light` class for the rest of the palette (defined in `:root` / `.mgn-root.mgn-theme-light` in `styles.css`).

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
