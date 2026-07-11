import {
  TFile,
  TextFileView,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type MaguilanotePlugin from "./main";
import { SettingsModal, TextPromptModal } from "./modals";
import { drawEdgesFn, renderCardFn } from "./render";
import { ContextToolbar, DrawSession } from "./draw";
import {
  BoardData,
  CARD_COLORS,
  CUSTOM_CARD_COLOR_KEYS,
  DEFAULT_STROKE_COLOR,
  Item,
  parseBoard,
} from "./types";
import { commit as commitImpl, undo as undoImpl, redo as redoImpl } from "./board-history";
import {
  applyTransform as applyTransformImpl,
  screenToWorld as screenToWorldImpl,
  viewCenter as viewCenterImpl,
  setZoom as setZoomImpl,
  zoomToFit as zoomToFitImpl,
  centerOn as centerOnImpl,
  cardWorldRects as cardWorldRectsImpl,
  onWheel as onWheelImpl,
} from "./board-camera";
import {
  onPointerDown as onPointerDownImpl,
  onPointerMove as onPointerMoveImpl,
  processPointerMove as processPointerMoveImpl,
  onPointerUp as onPointerUpImpl,
  cardIdUnder as cardIdUnderImpl,
  highlightCardUnder as highlightCardUnderImpl,
  clearCardHighlight as clearCardHighlightImpl,
  columnUnder as columnUnderImpl,
  highlightColumnUnder as highlightColumnUnderImpl,
  clearColumnHighlight as clearColumnHighlightImpl,
  refreshSelectionClasses as refreshSelectionClassesImpl,
  cloneInPlace as cloneInPlaceImpl,
} from "./board-interaction";
import type { DragMode } from "./board-interaction";
import {
  addItem as addItemImpl,
  addNote as addNoteImpl,
  addTodo as addTodoImpl,
  addColumn as addColumnImpl,
  addSwatch as addSwatchImpl,
  addComment as addCommentImpl,
  addRecord as addRecordImpl,
  createFromTool as createFromToolImpl,
  addLine as addLineImpl,
  promptLink as promptLinkImpl,
  promptBoard as promptBoardImpl,
  addVaultFile as addVaultFileImpl,
  addVaultFileAt as addVaultFileAtImpl,
} from "./board-item-crud";
import {
  copySelection as copySelectionImpl,
  pasteInternal as pasteInternalImpl,
  duplicateSelection as duplicateSelectionImpl,
  deleteSelection as deleteSelectionImpl,
} from "./board-clipboard";
import { onContextMenu as onContextMenuImpl } from "./board-context-menu";
import { onKeyDown as onKeyDownImpl } from "./board-keyboard";
import {
  onDrop as onDropImpl,
  onPaste as onPasteImpl,
  importOsFile as importOsFileImpl,
} from "./board-drop-import";
import {
  enterDrawMode as enterDrawModeImpl,
  exitDrawMode as exitDrawModeImpl,
  addSketch as addSketchImpl,
  openSketchPopup as openSketchPopupImpl,
} from "./drawing-toolbar";
import {
  openRecordPopup as openRecordPopupImpl,
  transcribeRecord as transcribeRecordImpl,
} from "./record-card";
import {
  relinkItem as relinkItemImpl,
  openPreviewFor as openPreviewForImpl,
  closePreview as closePreviewImpl,
} from "./file-preview";
import {
  openSearch as openSearchImpl,
  closeSearch as closeSearchImpl,
  runSearch as runSearchImpl,
} from "./board-search";

export const VIEW_TYPE_BOARD = "maguilanote-board";

export class BoardView extends TextFileView {
  plugin: MaguilanotePlugin;
  // NEVER name this "data": TextFileView.save() assigns `this.data = getViewData()`
  // (a string), which used to clobber our object and freeze the board.
  board: BoardData = { version: 1, items: [], edges: [] };

  panX = 0;
  panY = 0;
  zoom = 1;

  selection = new Set<string>();
  selectedEdges: Set<string> = new Set();
  spaceDown = false;
  drag: DragMode = { kind: "none" };

  history: string[] = [];
  histIdx = -1;

  viewportEl!: HTMLElement;
  worldEl!: HTMLElement;
  svgEl!: SVGSVGElement;
  labelsEl!: HTMLElement;
  searchEl!: HTMLElement;
  searchInput!: HTMLInputElement;
  zoomLabel!: HTMLElement;
  snapBtn!: HTMLElement;
  emptyHint!: HTMLElement;
  imgInput!: HTMLInputElement;
  tbEl!: HTMLElement;

  // active board-level draw mode (null when not drawing)
  drawMode: {
    session: DrawSession;
    toolbar: ContextToolbar;
    scrim: HTMLElement;
    surface: SVGSVGElement;
    editId: string | null;
    keyHandler: (e: KeyboardEvent) => void;
  } | null = null;

  searchHits: string[] = [];
  searchIdx = 0;

  crumbsEl!: HTMLElement;
  crumbs: { path: string; name: string }[] = [];
  pendingNav: string | null = null;
  pendingPos: { x: number; y: number } | null = null;

  // manual double-click detection (pointer capture retargets native dblclick)
  lastClickAt = 0;
  lastClickId: string | null = null;
  lastDownOnCanvas = false;
  // pointermove throttling (1x per frame)
  rafPending = false;
  lastMoveEvent: PointerEvent | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MaguilanotePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_BOARD;
  }
  getDisplayText() {
    return this.file?.basename ?? "Board";
  }
  getIcon() {
    return "layout-dashboard";
  }

  // ------------------------------------------------------------------ data
  getViewData(): string {
    return JSON.stringify(this.board, null, 2);
  }

  setViewData(raw: string, clear: boolean): void {
    this.board = parseBoard(raw);
    if (clear) {
      this.history = [JSON.stringify(this.board)];
      this.histIdx = 0;
      this.selection.clear();
      this.selectedEdges.clear();
    }
    this.render();
    this.renderCrumbs();
    window.setTimeout(() => this.zoomToFit(true), 50);
  }

  clear(): void {
    this.board = { version: 1, items: [], edges: [] };
  }

  async onLoadFile(file: TFile): Promise<void> {
    // navigating from outside (file explorer, quick switcher) resets the trail
    if (this.pendingNav !== file.path) this.crumbs = [];
    this.pendingNav = null;
    await super.onLoadFile(file);
  }

  /** open another .board in THIS view, pushing current board onto the trail */
  async navigateTo(f: TFile) {
    if (this.file) this.crumbs.push({ path: this.file.path, name: this.file.basename });
    this.pendingNav = f.path;
    await this.leaf.openFile(f);
  }

  renderCrumbs() {
    if (!this.crumbsEl) return;
    this.crumbsEl.empty();
    const parts = [
      ...this.crumbs,
      { path: this.file?.path ?? "", name: this.file?.basename ?? "Board" },
    ];
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const seg = this.crumbsEl.createSpan({
        cls: "mgn-crumb" + (last ? " mgn-crumb-current" : ""),
        text: p.name,
      });
      if (!last) {
        seg.addEventListener("click", () => {
          const f = this.app.vault.getAbstractFileByPath(p.path);
          if (f instanceof TFile) {
            this.crumbs = this.crumbs.slice(0, i);
            this.pendingNav = f.path;
            this.leaf.openFile(f);
          }
        });
        this.crumbsEl.createSpan({ cls: "mgn-crumb-sep", text: "›" });
      }
    });
  }

  /** apply the user's font / theme / color settings to this board's DOM */
  applyAppearance() {
    const s = this.plugin.settings;
    this.contentEl.style.setProperty("--mgn-font-family", s.fontFamily || "inherit");
    this.contentEl.toggleClass("mgn-theme-light", s.theme === "light");

    const c = s.colors[s.theme];
    this.contentEl.style.setProperty("--mgn-canvas-bg", c.canvasBg);
    this.contentEl.style.setProperty("--mgn-card-default-bg", c.cardDefaultBg);
    for (const key of CUSTOM_CARD_COLOR_KEYS) {
      this.contentEl.style.setProperty(`--mgn-card-color-${key}`, c[key]);
    }
  }

  /** Draw/Sketch's default pen color: readable against the opposite end of the
   * theme spectrum (white ink on the dark theme, dark ink on the light theme). */
  defaultStrokeColor(): string {
    return this.plugin.settings.theme === "dark" ? "#ffffff" : DEFAULT_STROKE_COLOR;
  }

  /** re-pick the vault file a card points to (broken/renamed references) */
  relinkItem(it: Item) { return relinkItemImpl(this, it); }

  /** inline preview overlay (double-click on a vault file card) */
  async openPreviewFor(it: Item) { return openPreviewForImpl(this, it); }

  closePreview() { return closePreviewImpl(this); }

  // -------------------------------------------------------------- drawing
  enterDrawMode(editItem?: Item) { return enterDrawModeImpl(this, editItem); }

  exitDrawMode(save: boolean) { return exitDrawModeImpl(this, save); }

  addSketch(x?: number, y?: number) { return addSketchImpl(this, x, y); }

  /** popup editor for a sketch card (draw only inside the fixed canvas) */
  openSketchPopup(it: Item) { return openSketchPopupImpl(this, it); }

  /** re-render a single card in place (safe during other interactions) */
  rerenderItem(it: Item) {
    const old = this.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${it.id}"]`);
    if (!old) {
      this.render();
      return;
    }
    const fresh = renderCardFn(this, it, !!it.parent);
    old.replaceWith(fresh);
    requestAnimationFrame(() => this.drawEdges());
  }

  /** push history snapshot, save + rerender */
  commit(rerender = true) { return commitImpl(this, rerender); }

  undo() { return undoImpl(this); }

  redo() { return redoImpl(this); }

  item(id: string): Item | undefined {
    return this.board.items.find((i) => i.id === id);
  }

  // ------------------------------------------------------------------ dom
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mgn-root");

    // toolbar
    const tb = root.createDiv({ cls: "mgn-toolbar" });
    this.tbEl = tb;
    // A tool is either drag-only (has `drag`, no `click`) or click-only
    // (`click`, optionally also draggable). Clicking a drag-only tool can't
    // create anything, so it shakes and shows a hint instead.
    const tool = (
      icon: string,
      label: string,
      opts: { drag?: string; click?: (ev: MouseEvent) => void }
    ) => {
      const b = tb.createDiv({ cls: "mgn-tool", attr: { "aria-label": label } });
      setIcon(b, icon);
      if (opts.click) {
        b.addEventListener("click", opts.click);
      } else if (opts.drag) {
        b.addEventListener("click", () => this.dragHint(b, "Drag onto the board"));
      }
      if (opts.drag) {
        b.draggable = true;
        b.addEventListener("dragstart", (ev: DragEvent) => {
          ev.dataTransfer?.setData("mgn-tool", opts.drag!);
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
        });
      }
      return b;
    };
    // group 1 — draggables (drag onto the board to create)
    tool("sticky-note", "Note", { drag: "note" });
    tool("list-todo", "To-do list", { drag: "todo" });
    tool("spline", "Line", { drag: "line" });
    tool("columns-3", "Column", { drag: "column" });
    tool("layout-dashboard", "Nested board", { drag: "board" });
    tool("palette", "Color swatch", { drag: "swatch" });
    tool("pen-tool", "Sketch card", { drag: "sketch" });
    tool("mic", "Record", { drag: "record" });
    tool("message-circle", "Comment", { drag: "comment" });
    tb.createDiv({ cls: "mgn-tool-sep" });
    // group 2 — flexible tools
    tool("image", "Image", { drag: "image" });
    tool("file", "Vault file", { drag: "file" });
    tool("link", "Link", { drag: "link" });
    tool("pencil", "Draw on the board (D)", { click: () => this.enterDrawMode() });
    // group 3 — controls
    tb.createDiv({ cls: "mgn-tool-sep" });
    tool("undo-2", "Undo (Ctrl+Z)", { click: () => this.undo() });
    tool("redo-2", "Redo (Ctrl+Shift+Z)", { click: () => this.redo() });

    this.imgInput = tb.createEl("input", {
      type: "file",
      attr: { accept: "image/*", multiple: true, style: "display:none" },
    });
    this.imgInput.addEventListener("change", async () => {
      const files = Array.from(this.imgInput.files ?? []);
      const base = this.pendingPos ?? this.viewCenter();
      this.pendingPos = null;
      let off = 0;
      for (const f of files) {
        await this.importOsFile(f, base.x + off, base.y + off);
        off += 30;
      }
      this.imgInput.value = "";
    });

    // viewport + world
    this.viewportEl = root.createDiv({ cls: "mgn-viewport" });
    this.viewportEl.tabIndex = 0;
    this.worldEl = this.viewportEl.createDiv({ cls: "mgn-world" });
    this.svgEl = this.worldEl.createSvg("svg", { cls: "mgn-edges" });
    const defs = this.svgEl.createSvg("defs");
    const marker = defs.createSvg("marker", {
      attr: {
        id: "mgn-arrowhead",
        viewBox: "0 0 10 10",
        refX: "9",
        refY: "5",
        markerWidth: "7",
        markerHeight: "7",
        orient: "auto-start-reverse",
      },
    });
    marker.createSvg("path", {
      attr: { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" },
    });
    // one fixed-fill marker per palette color: `currentColor` markers don't
    // reliably pick up a per-edge inline color in Obsidian's Electron build
    for (const c of CARD_COLORS) {
      const cm = defs.createSvg("marker", {
        attr: {
          id: `mgn-arrowhead-${c.key}`,
          viewBox: "0 0 10 10",
          refX: "9",
          refY: "5",
          markerWidth: "7",
          markerHeight: "7",
          orient: "auto-start-reverse",
        },
      });
      const cmPath = cm.createSvg("path", { attr: { d: "M 0 0 L 10 5 L 0 10 z" } });
      cmPath.style.fill = c.bg; // inline style (not the `fill` attr) so var()-based colors resolve
    }
    this.labelsEl = this.worldEl.createDiv({ cls: "mgn-edge-labels" });
    this.emptyHint = this.viewportEl.createDiv({
      cls: "mgn-empty",
      text: "Double-click to create a note — or drag a tool from the left toolbar",
    });

    // bottom bar: zoom + snap
    const zb = root.createDiv({ cls: "mgn-zoombar" });
    const zbtn = (icon: string, label: string, cb: () => void) => {
      const b = zb.createDiv({ cls: "mgn-tool", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", cb);
      return b;
    };
    zbtn("zoom-out", "Zoom out", () => this.setZoom(this.zoom / 1.2));
    this.zoomLabel = zb.createDiv({ cls: "mgn-zoom-label", text: "100%" });
    zbtn("zoom-in", "Zoom in", () => this.setZoom(this.zoom * 1.2));
    const pct = zb.createDiv({ cls: "mgn-zoom-100", text: "1:1", attr: { "aria-label": "Zoom to 100%" } });
    pct.addEventListener("click", () => this.setZoom(1));
    zbtn("maximize", "Zoom to fit", () => this.zoomToFit());
    zb.createDiv({ cls: "mgn-vsep" });
    this.snapBtn = zbtn("layout-grid", "Snap to grid (hold Ctrl while dragging to invert)", async () => {
      this.plugin.settings.gridSnap = !this.plugin.settings.gridSnap;
      await this.plugin.saveSettings();
      this.snapBtn.toggleClass("mgn-tool-active", this.plugin.settings.gridSnap);
    });
    this.snapBtn.toggleClass("mgn-tool-active", this.plugin.settings.gridSnap);
    zb.createDiv({ cls: "mgn-vsep" });
    zbtn("download", "Export templates", () => this.plugin.exportTemplates());
    zbtn("upload", "Import templates", () => this.plugin.importTemplates());
    zb.createDiv({ cls: "mgn-vsep" });
    zbtn("settings", "Maguilanote settings", () => new SettingsModal(this.app, this.plugin).open());

    // search bar
    this.searchEl = root.createDiv({ cls: "mgn-search" });
    this.searchInput = this.searchEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Search this board..." },
    });
    const searchCount = this.searchEl.createDiv({ cls: "mgn-search-count" });
    this.searchInput.addEventListener("input", () => {
      this.runSearch(this.searchInput.value);
      searchCount.setText(
        this.searchHits.length ? `${this.searchIdx + 1}/${this.searchHits.length}` : "0"
      );
    });
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.searchHits.length) {
        this.searchIdx = (this.searchIdx + 1) % this.searchHits.length;
        this.centerOn(this.searchHits[this.searchIdx]);
        searchCount.setText(`${this.searchIdx + 1}/${this.searchHits.length}`);
      } else if (e.key === "Escape") {
        this.closeSearch();
      }
    });
    this.searchEl.hide();

    // breadcrumb navigation (Board 1 › Board 2)
    this.crumbsEl = root.createDiv({ cls: "mgn-crumbs" });
    this.renderCrumbs();

    this.applyAppearance();

    // events
    this.registerDomEvent(this.viewportEl, "pointerdown", (e) => this.onPointerDown(e));
    this.registerDomEvent(this.viewportEl, "pointermove", (e) => this.onPointerMove(e));
    this.registerDomEvent(this.viewportEl, "pointerup", (e) => this.onPointerUp(e));
    this.registerDomEvent(this.viewportEl, "dblclick", (e) => this.onDblClick(e));
    this.registerDomEvent(this.viewportEl, "wheel", (e) => this.onWheel(e), { passive: false });
    this.registerDomEvent(this.viewportEl, "contextmenu", (e) => this.onContextMenu(e));
    this.registerDomEvent(this.viewportEl, "keydown", (e) => this.onKeyDown(e));
    this.registerDomEvent(this.viewportEl, "keyup", (e) => {
      if (e.code === "Space") this.spaceDown = false;
    });
    this.registerDomEvent(this.viewportEl, "dragover", (e) => e.preventDefault());
    this.registerDomEvent(this.viewportEl, "drop", (e) => this.onDrop(e));
    this.registerDomEvent(this.viewportEl, "paste", (e) => this.onPaste(e));

    this.applyTransform();
  }

  async onClose() {
    this.contentEl.empty();
  }

  /** visual nudge for a drag-only tool clicked instead of dragged */
  private dragHint(btn: HTMLElement, label: string) {
    btn.removeClass("mgn-tool-shake");
    void btn.offsetWidth; // restart the CSS animation
    btn.addClass("mgn-tool-shake");
    btn.addEventListener("animationend", () => btn.removeClass("mgn-tool-shake"), { once: true });

    this.tbEl.querySelector(".mgn-drag-hint")?.remove();
    const hint = this.tbEl.createDiv({ cls: "mgn-drag-hint", text: label });
    hint.style.top = `${btn.offsetTop}px`;
    window.setTimeout(() => hint.remove(), 1600);
  }

  // ------------------------------------------------------------- transforms
  applyTransform() { return applyTransformImpl(this); }

  screenToWorld(clientX: number, clientY: number) { return screenToWorldImpl(this, clientX, clientY); }

  viewCenter() { return viewCenterImpl(this); }

  setZoom(z: number, cx?: number, cy?: number) { return setZoomImpl(this, z, cx, cy); }

  zoomToFit(initial = false) { return zoomToFitImpl(this, initial); }

  centerOn(id: string) { return centerOnImpl(this, id); }

  /** world-space rects of every rendered card (incl. column children) */
  cardWorldRects(): Map<string, { x: number; y: number; w: number; h: number }> {
    return cardWorldRectsImpl(this);
  }

  // ------------------------------------------------------------------ render
  render() {
    if (!this.worldEl) return;
    this.worldEl.querySelectorAll(".mgn-card").forEach((el) => el.remove());
    this.emptyHint?.toggle(this.board.items.length === 0);

    const roots = this.board.items.filter((i) => !i.parent && i.id !== this.drawMode?.editId);
    for (const it of roots) {
      this.worldEl.appendChild(renderCardFn(this, it));
    }
    requestAnimationFrame(() => this.drawEdges());
  }

  drawEdges() {
    drawEdgesFn(this);
  }

  resolveFile(path?: string): TFile | null {
    if (!path) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    return this.app.metadataCache.getFirstLinkpathDest(path, this.file?.path ?? "");
  }

  // ------------------------------------------------------------ interaction
  onPointerDown(e: PointerEvent) { return onPointerDownImpl(this, e); }

  /** clone items (incl. column children + internal edges) at the same position */
  cloneInPlace(rootIds: string[]): string[] { return cloneInPlaceImpl(this, rootIds); }

  onPointerMove(e: PointerEvent) { return onPointerMoveImpl(this, e); }

  processPointerMove(e: PointerEvent) { return processPointerMoveImpl(this, e); }

  onPointerUp(e: PointerEvent) { return onPointerUpImpl(this, e); }

  /** id of the topmost card under the pointer, or null over empty canvas */
  cardIdUnder(e: PointerEvent | MouseEvent): string | null { return cardIdUnderImpl(this, e); }

  highlightCardUnder(e: PointerEvent) { return highlightCardUnderImpl(this, e); }

  clearCardHighlight() { return clearCardHighlightImpl(this); }

  columnUnder(e: PointerEvent, draggedIds: string[]): Item | null { return columnUnderImpl(this, e, draggedIds); }

  highlightColumnUnder(e: PointerEvent, ids: string[]) { return highlightColumnUnderImpl(this, e, ids); }

  clearColumnHighlight() { return clearColumnHighlightImpl(this); }

  refreshSelectionClasses() { return refreshSelectionClassesImpl(this); }

  onWheel(e: WheelEvent) { return onWheelImpl(this, e); }

  onDblClick(e: MouseEvent) {
    if (this.drawMode) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, audio, video, iframe, .mgn-connector, .mgn-resize")) return;

    const edgeEl = target.closest<HTMLElement>(".mgn-edge-hit, .mgn-edge-label");
    if (edgeEl?.dataset.id) {
      const edge = this.board.edges.find((x) => x.id === edgeEl.dataset.id);
      if (edge)
        new TextPromptModal(this.app, "Arrow label", edge.label ?? "", (v) => {
          edge.label = v || undefined;
          this.commit();
        }).open();
      return;
    }

    const cardEl = target.closest<HTMLElement>(".mgn-card");
    if (cardEl?.dataset.id) {
      const it = this.item(cardEl.dataset.id);
      if (it) this.openCard(it);
      return;
    }

    // empty canvas: new note — ONLY if the clicks really started on the canvas
    // (pointer capture retargets card dblclicks to the viewport)
    if (!this.lastDownOnCanvas) return;
    const w = this.screenToWorld(e.clientX, e.clientY);
    this.addNote(w.x, w.y, true);
  }

  /** double-click action for a card */
  openCard(it: Item) {
    switch (it.type) {
      case "note":
      case "comment": {
        const el = this.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${it.id}"]`);
        if (el) this.editNote(it, el);
        return;
      }
      case "board": {
        const f = this.resolveFile(it.path);
        if (f) this.navigateTo(f);
        else this.relinkItem(it); // broken reference: pick the file again
        return;
      }
      case "image":
      case "file":
        this.openPreviewFor(it);
        return;
      case "link":
        if (it.url) window.open(it.url, "_blank");
        return;
      case "drawing":
        this.enterDrawMode(it);
        return;
      case "sketch":
        this.openSketchPopup(it);
        return;
      case "record":
        this.openRecordPopup(it);
        return;
      case "swatch":
      case "todo":
      case "column":
        return;
    }
  }

  editNote(it: Item, cardEl: HTMLElement) {
    if (it.locked) return;
    const body = cardEl.querySelector<HTMLElement>(".mgn-note-body");
    if (!body) return;
    body.empty();
    body.style.pointerEvents = "auto";
    const ta = body.createEl("textarea", {
      cls: "mgn-note-edit",
      attr: { placeholder: "Start typing..." },
    });
    ta.value = it.text ?? "";
    const fit = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
      this.drawEdges();
    };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        ta.blur();
      }
    });
    ta.addEventListener("blur", () => {
      it.text = ta.value;
      this.commit(false); // save + history, but no full re-render
      this.rerenderItem(it); // surgical: does not break drags elsewhere
    });
    window.setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      fit();
    }, 10);
  }

  onContextMenu(e: MouseEvent) { return onContextMenuImpl(this, e); }

  onKeyDown(e: KeyboardEvent) { return onKeyDownImpl(this, e); }

  // ------------------------------------------------------------- add items
  addItem(partial: Partial<Item> & { type: Item["type"] }, x?: number, y?: number): Item {
    return addItemImpl(this, partial, x, y);
  }

  addNote(x?: number, y?: number, edit = false) { return addNoteImpl(this, x, y, edit); }

  addTodo(x?: number, y?: number) { return addTodoImpl(this, x, y); }

  addColumn(x?: number, y?: number) { return addColumnImpl(this, x, y); }

  addSwatch(x?: number, y?: number) { return addSwatchImpl(this, x, y); }

  addComment(x?: number, y?: number) { return addCommentImpl(this, x, y); }

  addRecord(x?: number, y?: number) { return addRecordImpl(this, x, y); }

  createFromTool(key: string, x: number, y: number) { return createFromToolImpl(this, key, x, y); }

  /** drop a standalone line centered on (x, y); both ends free, selected */
  addLine(x: number, y: number) { return addLineImpl(this, x, y); }

  promptLink(pos?: { x: number; y: number }) { return promptLinkImpl(this, pos); }

  promptBoard(pos?: { x: number; y: number }) { return promptBoardImpl(this, pos); }

  addVaultFile(f: TFile) { return addVaultFileImpl(this, f); }

  addVaultFileAt(f: TFile, x: number, y: number) { return addVaultFileAtImpl(this, f, x, y); }

  // ------------------------------------------------------ clipboard & dupes
  copySelection(cut: boolean) { return copySelectionImpl(this, cut); }

  pasteInternal() { return pasteInternalImpl(this); }

  duplicateSelection() { return duplicateSelectionImpl(this); }

  deleteSelection() { return deleteSelectionImpl(this); }

  // --------------------------------------------------------- import / drop
  async onDrop(e: DragEvent) { return onDropImpl(this, e); }

  async onPaste(e: ClipboardEvent) { return onPasteImpl(this, e); }

  async importOsFile(f: File, x: number, y: number) { return importOsFileImpl(this, f, x, y); }

  /** popup recorder for a record card: pick mic, record, save as vault audio file */
  openRecordPopup(it: Item) { return openRecordPopupImpl(this, it); }

  /** transcribe a record card's audio via the OpenAI Whisper API, dropping the
   * result into a new note card connected back to the recording */
  async transcribeRecord(it: Item) { return transcribeRecordImpl(this, it); }

  // ---------------------------------------------------------------- search
  openSearch() { return openSearchImpl(this); }

  closeSearch() { return closeSearchImpl(this); }

  runSearch(q: string) { return runSearchImpl(this, q); }
}
