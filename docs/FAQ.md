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

### How does "Transcribe text" on a Record card work, and does it cost anything?

It calls the OpenAI Whisper API (`whisper-1`) with the API key from Settings → Recording → "OpenAI API key". This is the only network call the plugin makes to an external service, and it's opt-in: nothing happens until the user pastes a key and clicks "Transcribe text" in a selected recording card's contextual toolbar. The Whisper API is paid (usage-based, no free tier) — see [DEPENDENCIES.md](DEPENDENCIES.md) if you're wondering whether this counts as a "dependency" (it doesn't: no npm package, just a `fetch` call).

### Where is the OpenAI API key actually stored — is it in my vault?

On desktop, no: `src/secrets.ts` writes it to `~/.maguilanote/secrets.json`, outside any vault, specifically so a vault backup/sync doesn't carry your key along. It's still plaintext on disk (no OS keychain integration), just not vault-bound. On mobile there's no filesystem access outside the vault, so it falls back to `MaguilanoteSettings.openaiApiKey` in the vault's `data.json` — the Settings screen says so. `MaguilanotePlugin.getOpenAiApiKey()` is the single place that decides which source to read.

### How do I change which file extensions are treated as images/audio/video?

`IMAGE_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS` in `src/types.ts`. These decide how a dropped vault file is classified into a card (e.g. an image card vs. a generic file card).

### How do I change keyboard shortcuts?

Users rebind keyboard shortcuts themselves: gear icon next to the breadcrumb trail → **Settings** → **Shortcuts**. Bindings are stored in `MaguilanoteSettings.keybindings` (`src/main.ts`), keyed by `ShortcutActionId`. To add a new rebindable action: add the id to `ShortcutActionId`, its label to `SHORTCUT_LABELS`, and its default to `DEFAULT_KEYBINDINGS` (all in `src/types.ts`), then check `matchesBinding(e, kb.<id>)` in `onKeyDown` in `src/board-view.ts`. Mouse/gesture-only shortcuts (not key-based) are the static `MOUSE_SHORTCUTS` reference table in `src/modals.ts` (`SettingsModal`).

### How do I change font / theme / color defaults?

`DEFAULT_SETTINGS.fontFamily` (body font), `.headingFontFamily` (card/column titles, falls back to the body font when blank), and `.theme` (`"dark" | "light"`) in `src/main.ts` — all exposed as user settings (gear icon → Settings → Customization). Font values are either a preset (`FONT_CHOICES` in `src/settings-ui.ts`) or a free-typed Google Font family name; `src/fonts.ts`'s `ensureGoogleFont()` fetches it via a `fonts.googleapis.com` stylesheet `<link>` and `fontFamilyValue()` turns the setting into the actual CSS `font-family` value written onto `--mgn-font-family` / `--mgn-font-family-heading` by `BoardView.applyAppearance()`. The board/card colors themselves live in `DEFAULT_THEME_COLORS` (`src/types.ts`), one `ThemeColors` object per theme (`canvasBg`, `cardDefaultBg`, and the 8 named card colors); users can override any of them per-theme from the same Customization section, stored in `settings.colors.light` / `settings.colors.dark`. `BoardView.applyAppearance()` (`src/board-view.ts`) writes the active theme's values onto the corresponding `--mgn-canvas-bg` / `--mgn-card-default-bg` / `--mgn-card-color-*` CSS variables, and toggles the `.mgn-theme-light` class for the rest of the palette (defined in `:root` / `.mgn-root.mgn-theme-light` in `styles.css`).

### How do I change the default templates folder name?

`DEFAULT_SETTINGS.templatesFolder` in `src/main.ts` (default: `"Maguilanote Templates"`). Also a user-facing setting.

### Where do dropped files, images and recordings get saved?

Into the **Assets folder** — `DEFAULT_SETTINGS.assetsFolder` in `src/main.ts` (default: `"Maguilanote Assets"`), a user-facing setting next to the templates folder. Read by `importOsFile` (`src/board-drop-import.ts`) and `saveAssetBinary` (`src/record-card.ts`); the folder is created on first use. Assets unpacked from a `.board.template` are the one exception — they land next to the imported board so a bundle stays self-contained (`unbundleTemplate` in `src/template-bundle.ts`).

### How do I export or import a template?

Zoombar (bottom bar) → the download/upload icons next to Snap to grid. Export ("Save current board as template" as a command too) takes the currently open board, walks it recursively (nested board cards, images, files, recordings), and packs everything into one `<name>.board.template` file in the templates folder — a single portable, self-contained file, unlike a plain `.board` copy which breaks the moment the board references anything outside itself. **Import replaces the board you have open**: it reads a `.board.template` from anywhere (file picker restricted to that extension; defaults to the templates folder on desktop), and after a confirmation modal (cancellable — a template file can bundle files of any type) unpacks it next to your current board, opens the result in its place, and sends the board it replaced to Obsidian's trash. To add a template to your library *without* replacing anything, use the "New board from template" command instead — it picks from `.board.template` files already in the templates folder and opens the unpacked result as a new board next to the active file. Format and logic live in `src/template-bundle.ts` (`TemplateBundle`, `collectBundle`, `unbundleTemplate`); wiring in `MaguilanotePlugin.exportBoardAsTemplate()` / `.importTemplateFile()` / `.openImportTemplateDialog()` in `src/main.ts`.

### Where is the board file format defined, and is it stable?

`BoardData` / `Item` / `Edge` in `src/types.ts`. `BoardData.version` exists specifically so future format changes can be migrated instead of breaking old boards — bump it and add a migration in `parseBoard` if you change the shape of stored data. Any format change is a "significant change" and must be documented (see the documentation policy in [.claude/CLAUDE.md](../.claude/CLAUDE.md) and logged in [CHANGELOG.md](CHANGELOG.md)).

### Why isn't there real-time collaboration / cloud sync?

Deliberate scope decision, not a gap: the plugin is local-first, one JSON file per board, no server or account. If you want sync, use whatever your vault already uses for that (Obsidian Sync, Git, Syncthing, etc.). See "Why no cloud/collaboration layer" in [ARCHITECTURE.md](ARCHITECTURE.md).

### How do I build without npm?

`node build-local.mjs` (Node 22+, no installed dependencies, no bundler). See [DEVELOPMENT.md](DEVELOPMENT.md).

### Can I bump a dependency version?

Only with explicit approval — versions are pinned on purpose. See [DEPENDENCIES.md](DEPENDENCIES.md).
