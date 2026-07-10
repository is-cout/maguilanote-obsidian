import {
  MarkdownRenderer,
  Menu,
  Notice,
  TFile,
  TextFileView,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
  setIcon,
} from "obsidian";
import type MaguilanotePlugin from "./main";
import { SettingsModal, TextPromptModal, VaultFilePicker } from "./modals";
import { drawEdgesFn, renderCardFn } from "./render";
import { ContextToolbar, CtxGroup, DrawSession, DrawTool, groupStrokes } from "./draw";
import {
  AUDIO_EXTS,
  BoardData,
  CARD_COLORS,
  CUSTOM_CARD_COLOR_KEYS,
  DEFAULT_STROKE_COLOR,
  DRAW_GROUP_DISTANCE,
  Edge,
  IMAGE_EXTS,
  Item,
  STROKE_SIZES,
  VIDEO_EXTS,
  colorOf,
  matchesBinding,
  newId,
  parseBoard,
} from "./types";

export const VIEW_TYPE_BOARD = "maguilanote-board";

// fixed pen-ink palette for the Draw/Sketch color picker — intentionally not
// theme-dependent (see renderColorControl)
const DRAW_SWATCHES = [
  "#33343d", "#fff5c0", "#ffd9b0", "#ffc7c2", "#e2cbf7",
  "#c4ddff", "#bdede0", "#d3f2c0", "#e4e4e8", "#ffffff",
];

/** true if segment (x0,y0)-(x1,y1) touches or crosses axis-aligned rect [xmin,xmax]x[ymin,ymax] (Liang-Barsky clip test) */
function segmentIntersectsRect(
  x0: number, y0: number, x1: number, y1: number,
  xmin: number, ymin: number, xmax: number, ymax: number
): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallel to this edge and outside it
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}

type DragMode =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | {
      kind: "move";
      ids: string[];
      startWX: number;
      startWY: number;
      orig: Map<string, { x: number; y: number }>;
      moved: boolean;
      detach?: boolean;
    }
  | { kind: "rubber"; startX: number; startY: number; el: HTMLElement }
  | { kind: "resize"; id: string; startWX: number; startWY: number; w0: number; h0: number }
  | { kind: "connect"; from: string; tempPath: SVGPathElement }
  | { kind: "line-end"; id: string; end: "from" | "to" | "bend"; moved: boolean };

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
  private rafPending = false;
  private lastMoveEvent: PointerEvent | null = null;

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
  private defaultStrokeColor(): string {
    return this.plugin.settings.theme === "dark" ? "#ffffff" : DEFAULT_STROKE_COLOR;
  }

  /** re-pick the vault file a card points to (broken/renamed references) */
  relinkItem(it: Item) {
    new VaultFilePicker(this.app, (f) => {
      it.path = f.path;
      if (it.type === "board") it.title = f.basename;
      if (it.type === "file") it.title = f.name;
      this.commit();
    }).open();
  }

  /** inline preview overlay (double-click on a vault file card) */
  async openPreviewFor(it: Item) {
    if (it.type === "board") {
      const bf = this.resolveFile(it.path);
      if (bf) this.navigateTo(bf);
      else this.relinkItem(it);
      return;
    }
    const f = this.resolveFile(it.path);
    if (!f) {
      // broken reference: let the user re-pick the file
      this.relinkItem(it);
      return;
    }
    this.closePreview();
    const ov = this.contentEl.createDiv({ cls: "mgn-preview" });
    const panel = ov.createDiv({ cls: "mgn-preview-panel" });
    const head = panel.createDiv({ cls: "mgn-preview-head" });
    const crumb = head.createDiv({ cls: "mgn-preview-crumbs" });
    crumb.createSpan({ cls: "mgn-crumb", text: this.file?.basename ?? "Board" });
    crumb.createSpan({ cls: "mgn-crumb-sep", text: "›" });
    crumb.createSpan({ cls: "mgn-crumb-current", text: f.name });
    const actions = head.createDiv({ cls: "mgn-preview-actions" });
    const openBtn = actions.createEl("button", { text: "Open in Obsidian" });
    openBtn.addEventListener("click", () => {
      this.closePreview();
      this.app.workspace.getLeaf("tab").openFile(f);
    });
    const closeBtn = actions.createEl("button", { cls: "mgn-preview-close", text: "✕" });
    closeBtn.addEventListener("click", () => this.closePreview());
    ov.addEventListener("click", (e) => {
      if (e.target === ov) this.closePreview();
    });
    const body = panel.createDiv({ cls: "mgn-preview-body markdown-rendered" });
    const ext = f.extension.toLowerCase();
    if (ext === "md") {
      const text = await this.app.vault.cachedRead(f);
      await MarkdownRenderer.render(this.app, text, body, f.path, this);
    } else if (IMAGE_EXTS.includes(ext)) {
      body.createEl("img", {
        attr: { src: this.app.vault.getResourcePath(f), style: "max-width:100%;border-radius:4px;" },
      });
    } else if (AUDIO_EXTS.includes(ext)) {
      body.createEl("audio", {
        attr: { controls: "true", src: this.app.vault.getResourcePath(f), style: "width:100%;" },
      });
    } else if (VIDEO_EXTS.includes(ext)) {
      body.createEl("video", {
        attr: { controls: "true", src: this.app.vault.getResourcePath(f), style: "width:100%;" },
      });
    } else {
      body.createDiv({ text: `No preview available for .${ext} files.` });
    }
  }

  closePreview() {
    this.contentEl.querySelector(".mgn-preview")?.remove();
  }

  // -------------------------------------------------------------- drawing
  /** shared contextual toolbar for board draw mode and the sketch popup */
  private makeDrawToolbar(
    host: HTMLElement,
    session: DrawSession,
    onSave: () => void,
    onDiscard: () => void,
    inline: boolean
  ): ContextToolbar {
    let bar: ContextToolbar;
    const setTool = (t: DrawTool) => {
      session.tool = t;
      bar.setActive("pen", t === "pen");
      bar.setActive("select", t === "select");
      bar.setActive("eraser", t === "eraser");
    };
    const groups: CtxGroup[] = [
      [
        { id: "pen", icon: "pen", label: "Pen", onClick: () => setTool("pen") },
        { id: "select", icon: "lasso", label: "Select", onClick: () => setTool("select") },
        { id: "eraser", icon: "eraser", label: "Eraser", onClick: () => setTool("eraser") },
      ],
      [
        { render: (h) => this.renderColorControl(h, session) },
        { render: (h) => this.renderSizeControl(h, session) },
      ],
      [
        { icon: "undo-2", label: "Undo", onClick: () => session.undo() },
        { icon: "redo-2", label: "Redo", onClick: () => session.redo() },
      ],
      [
        { icon: "x", label: "Discard", onClick: onDiscard },
        { icon: "check", label: "Save", onClick: onSave },
      ],
    ];
    bar = new ContextToolbar(host, this.tbEl, groups, inline);
    setTool("pen");
    return bar;
  }

  /** popover anchored to a toolbar button; closes on outside click */
  private makePopover(anchor: HTMLElement): HTMLElement {
    this.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
    const pop = this.contentEl.createDiv({ cls: "mgn-ctx-popover" });
    const cr = this.contentEl.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    pop.style.left = `${ar.right - cr.left + 8}px`;
    pop.style.top = `${ar.top - cr.top}px`;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchor.contains(t) || pop.contains(t)) return; // keep open for clicks inside
      pop.remove();
      document.removeEventListener("pointerdown", close, true);
    };
    window.setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
    return pop;
  }

  /** color button: card-color presets + a custom picker; recolors selection */
  private renderColorControl(h: HTMLElement, session: DrawSession) {
    const btn = h.createDiv({ cls: "mgn-ctx-tool mgn-ctx-swatchbtn", attr: { "aria-label": "Color" } });
    const dot = btn.createDiv({ cls: "mgn-ctx-colordot" });
    dot.style.background = session.color;
    const pick = (c: string, close = true) => {
      session.color = c;
      session.recolorSelection(c);
      dot.style.background = c;
      if (close) this.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
    };
    btn.addEventListener("click", () => {
      if (this.contentEl.querySelector(".mgn-ctx-popover")) {
        this.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
        return;
      }
      const pop = this.makePopover(btn);
      const grid = pop.createDiv({ cls: "mgn-ctx-colorgrid" });
      // fixed ink colors: pen strokes are drawn once and persisted as plain hex,
      // unlike card backgrounds they must not shift with the board theme setting
      for (const hex of DRAW_SWATCHES) {
        const sw = grid.createDiv({ cls: "mgn-ctx-swatch" });
        sw.style.background = hex;
        sw.addEventListener("click", () => pick(hex));
      }
      const custom = pop.createEl("input", {
        type: "color",
        cls: "mgn-ctx-customcolor",
        value: /^#[0-9a-f]{6}$/i.test(session.color) ? session.color : "#000000",
        attr: { "aria-label": "Custom color" },
      });
      custom.addEventListener("input", () => pick(custom.value, false));
    });
  }

  /** size button: preset stroke widths (affects new strokes only) */
  private renderSizeControl(h: HTMLElement, session: DrawSession) {
    const btn = h.createDiv({ cls: "mgn-ctx-tool mgn-ctx-sizebtn", attr: { "aria-label": "Stroke size" } });
    const dot = btn.createDiv({ cls: "mgn-ctx-sizedot" });
    const sizeDot = (el: HTMLElement, s: number) => {
      const d = Math.max(3, Math.min(18, s));
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
    };
    sizeDot(dot, session.size);
    btn.addEventListener("click", () => {
      if (this.contentEl.querySelector(".mgn-ctx-popover")) {
        this.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
        return;
      }
      const pop = this.makePopover(btn);
      const list = pop.createDiv({ cls: "mgn-ctx-sizelist" });
      for (const s of STROKE_SIZES) {
        const row = list.createDiv({ cls: "mgn-ctx-sizerow" });
        sizeDot(row.createDiv({ cls: "mgn-ctx-sizedot" }), s);
        row.addEventListener("click", () => {
          session.size = s;
          sizeDot(dot, s);
          this.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
        });
      }
    });
  }

  /** create the world-space SVG surface + viewBox aligned to the current view */
  private makeSurface(): SVGSVGElement {
    const surface = this.viewportEl.createSvg("svg", { cls: "mgn-draw-surface" }) as unknown as SVGSVGElement;
    const vr = this.viewportEl.getBoundingClientRect();
    const tl = this.screenToWorld(vr.left, vr.top);
    surface.setAttribute("viewBox", `${tl.x} ${tl.y} ${vr.width / this.zoom} ${vr.height / this.zoom}`);
    return surface;
  }

  enterDrawMode(editItem?: Item) {
    if (this.drawMode) return;
    this.closePreview();
    this.selection.clear();
    this.refreshSelectionClasses();
    this.viewportEl.addClass("mgn-draw-active"); // fades the board (all cards) uniformly

    const scrim = this.viewportEl.createDiv({ cls: "mgn-draw-scrim" });
    const surface = this.makeSurface();
    const session = new DrawSession({
      svg: surface,
      toCoords: (e) => this.screenToWorld(e.clientX, e.clientY),
    });
    session.color = this.defaultStrokeColor();
    if (editItem?.strokes) {
      // rebase local strokes back to world coords for editing
      session.setStrokes(
        editItem.strokes.map((s) => ({
          color: s.color,
          size: s.size,
          points: s.points.map((p) => [p[0] + editItem.x, p[1] + editItem.y, p[2] ?? 0.5]),
        }))
      );
    }
    const toolbar = this.makeDrawToolbar(
      this.viewportEl,
      session,
      () => this.exitDrawMode(true),
      () => this.exitDrawMode(false),
      false
    );
    // keys reach here via document (the SVG surface never holds focus)
    const keyHandler = (e: KeyboardEvent) => {
      const m = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.exitDrawMode(false); }
      else if (m && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); session.undo(); }
      else if ((m && e.key.toLowerCase() === "z" && e.shiftKey) || (m && e.key.toLowerCase() === "y")) { e.preventDefault(); e.stopPropagation(); session.redo(); }
    };
    document.addEventListener("keydown", keyHandler, true);

    this.drawMode = { session, toolbar, scrim, surface, editId: editItem?.id ?? null, keyHandler };
    if (editItem) this.render(); // hide the item being edited (shown live on the surface)
  }

  exitDrawMode(save: boolean) {
    const dm = this.drawMode;
    if (!dm) return;
    document.removeEventListener("keydown", dm.keyHandler, true);
    dm.toolbar.close();
    dm.surface.remove();
    dm.scrim.remove();
    this.viewportEl.removeClass("mgn-draw-active");
    this.drawMode = null;

    if (!save) {
      if (dm.editId) this.render(); // restore the item we hid for editing
      return;
    }
    // remove the item being edited; it is replaced by the regrouped result
    if (dm.editId) this.board.items = this.board.items.filter((i) => i.id !== dm.editId);
    const groups = groupStrokes(dm.session.strokes, DRAW_GROUP_DISTANCE);
    const newIds: string[] = [];
    for (const g of groups) {
      const it: Item = {
        id: newId(),
        type: "drawing",
        x: g.box.x,
        y: g.box.y,
        w: g.box.w,
        h: g.box.h,
        strokes: g.strokes,
      };
      this.board.items.push(it);
      newIds.push(it.id);
    }
    this.selection = new Set(newIds);
    this.commit();
  }

  addSketch(x?: number, y?: number) {
    this.addItem({ type: "sketch", strokes: [], w: 280, h: 200 }, x, y);
  }

  /** popup editor for a sketch card (draw only inside the fixed canvas) */
  openSketchPopup(it: Item) {
    this.closePreview();
    const W = 640, H = 440;
    const ov = this.contentEl.createDiv({ cls: "mgn-preview" });
    const panel = ov.createDiv({ cls: "mgn-preview-panel mgn-sketch-panel" });
    const head = panel.createDiv({ cls: "mgn-preview-head" });
    head.createDiv({ cls: "mgn-preview-crumbs" }).createSpan({ cls: "mgn-crumb-current", text: "Sketch" });
    const body = panel.createDiv({ cls: "mgn-preview-body mgn-sketch-body" });
    // NB: createSvg rejects a cls string with spaces — pass classes as an array
    const surface = body.createSvg("svg", {
      cls: ["mgn-draw-surface", "mgn-sketch-surface"],
      attr: { viewBox: `0 0 ${W} ${H}` },
    }) as unknown as SVGSVGElement;
    surface.style.width = `${W}px`;
    surface.style.height = `${H}px`;

    const session = new DrawSession({
      svg: surface,
      toCoords: (e) => {
        const r = surface.getBoundingClientRect();
        return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
      },
    });
    session.color = this.defaultStrokeColor();
    session.setStrokes(it.strokes ?? []);

    let toolbar: ContextToolbar;
    const finish = (save: boolean) => {
      if (save) {
        it.strokes = structuredClone(session.strokes);
        this.commit(false);
        this.rerenderItem(it);
      }
      document.removeEventListener("keydown", keyHandler, true);
      toolbar.close();
      ov.remove();
    };
    const keyHandler = (e: KeyboardEvent) => {
      const m = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (m && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); session.undo(); }
      else if ((m && e.key.toLowerCase() === "z" && e.shiftKey) || (m && e.key.toLowerCase() === "y")) { e.preventDefault(); e.stopPropagation(); session.redo(); }
    };
    document.addEventListener("keydown", keyHandler, true);
    ov.addEventListener("pointerdown", (e) => { if (e.target === ov) finish(false); });

    // reuse the same floating toolbar as board draw mode; mount inside the
    // overlay so it renders above it (a toolbar in viewportEl sits behind ov)
    toolbar = this.makeDrawToolbar(ov, session, () => finish(true), () => finish(false), false);
  }

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
  commit(rerender = true) {
    this.history = this.history.slice(0, this.histIdx + 1);
    this.history.push(JSON.stringify(this.board));
    if (this.history.length > 100) this.history.shift();
    this.histIdx = this.history.length - 1;
    this.requestSave();
    if (rerender) this.render();
  }

  undo() {
    if (this.histIdx <= 0) return;
    this.histIdx--;
    this.board = JSON.parse(this.history[this.histIdx]);
    this.selection.clear();
    this.requestSave();
    this.render();
  }

  redo() {
    if (this.histIdx >= this.history.length - 1) return;
    this.histIdx++;
    this.board = JSON.parse(this.history[this.histIdx]);
    this.selection.clear();
    this.requestSave();
    this.render();
  }

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

    // settings gear, separate panel to the left of the breadcrumb trail
    const settingsBtn = root.createDiv({
      cls: "mgn-settings-btn",
      attr: { "aria-label": "Maguilanote settings" },
    });
    setIcon(settingsBtn, "settings");
    settingsBtn.addEventListener("click", () => new SettingsModal(this.app, this.plugin).open());

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
  applyTransform() {
    this.worldEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.zoomLabel?.setText(`${Math.round(this.zoom * 100)}%`);
    const gs = 24 * this.zoom;
    this.viewportEl.style.backgroundSize = `${gs}px ${gs}px`;
    this.viewportEl.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
  }

  screenToWorld(clientX: number, clientY: number) {
    const r = this.viewportEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.panX) / this.zoom,
      y: (clientY - r.top - this.panY) / this.zoom,
    };
  }

  viewCenter() {
    const r = this.viewportEl.getBoundingClientRect();
    return this.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  setZoom(z: number, cx?: number, cy?: number) {
    z = Math.min(3, Math.max(0.1, z));
    const r = this.viewportEl.getBoundingClientRect();
    const px = cx ?? r.left + r.width / 2;
    const py = cy ?? r.top + r.height / 2;
    const before = this.screenToWorld(px, py);
    this.zoom = z;
    const afterX = before.x * this.zoom + this.panX + r.left;
    const afterY = before.y * this.zoom + this.panY + r.top;
    this.panX += px - afterX;
    this.panY += py - afterY;
    this.applyTransform();
  }

  zoomToFit(initial = false) {
    const rects = this.cardWorldRects();
    if (!rects.size) {
      if (!initial) new Notice("Board is empty");
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects.values()) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    const vr = this.viewportEl.getBoundingClientRect();
    const pad = 60;
    const zw = (vr.width - pad * 2) / (maxX - minX || 1);
    const zh = (vr.height - pad * 2) / (maxY - minY || 1);
    this.zoom = Math.min(1.25, Math.max(0.1, Math.min(zw, zh)));
    this.panX = (vr.width - (maxX - minX) * this.zoom) / 2 - minX * this.zoom;
    this.panY = (vr.height - (maxY - minY) * this.zoom) / 2 - minY * this.zoom;
    this.applyTransform();
  }

  centerOn(id: string) {
    const rects = this.cardWorldRects();
    const r = rects.get(id);
    if (!r) return;
    const vr = this.viewportEl.getBoundingClientRect();
    this.panX = vr.width / 2 - (r.x + r.w / 2) * this.zoom;
    this.panY = vr.height / 2 - (r.y + r.h / 2) * this.zoom;
    this.applyTransform();
  }

  /** world-space rects of every rendered card (incl. column children) */
  cardWorldRects(): Map<string, { x: number; y: number; w: number; h: number }> {
    const map = new Map<string, { x: number; y: number; w: number; h: number }>();
    const wr = this.worldEl.getBoundingClientRect();
    this.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
      const id = el.dataset.id;
      if (!id) return;
      const r = el.getBoundingClientRect();
      map.set(id, {
        x: (r.left - wr.left) / this.zoom,
        y: (r.top - wr.top) / this.zoom,
        w: r.width / this.zoom,
        h: r.height / this.zoom,
      });
    });
    return map;
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
  onPointerDown(e: PointerEvent) {
    if (this.drawMode) return; // draw surface handles its own pointers
    const target = e.target as HTMLElement;
    // never steal focus from active inputs/editors (blur would kill them)
    const interactive = !!target.closest(
      "input, textarea, audio, video, iframe, a, button, .mgn-todo-del, .mgn-col-collapse, [contenteditable=true]"
    );
    if (!interactive) this.viewportEl.focus({ preventScroll: true });

    // middle mouse OR space+left => pan
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: this.panX, panY: this.panY };
      this.viewportEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    if (interactive) return;

    this.lastDownOnCanvas = false;

    const connEl = target.closest<HTMLElement>(".mgn-connector");
    if (connEl?.dataset.for) {
      const tempPath = this.svgEl.createSvg("path", {
        cls: ["mgn-edge", "mgn-edge-temp"],
        attr: { fill: "none" },
      });
      this.drag = { kind: "connect", from: connEl.dataset.for, tempPath };
      this.viewportEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const rezEl = target.closest<HTMLElement>(".mgn-resize");
    if (rezEl?.dataset.for) {
      const it = this.item(rezEl.dataset.for);
      if (!it || it.locked) return;
      const w = this.screenToWorld(e.clientX, e.clientY);
      const cardDom = this.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${it.id}"]`);
      const h0 = it.h ?? (cardDom ? cardDom.getBoundingClientRect().height / this.zoom : 60);
      this.drag = { kind: "resize", id: it.id, startWX: w.x, startWY: w.y, w0: it.w, h0 };
      this.viewportEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // dragging a selected line's endpoint handle
    const handleEl = target.closest<SVGElement>(".mgn-edge-handle");
    if (handleEl?.dataset.id && handleEl.dataset.end) {
      this.drag = {
        kind: "line-end",
        id: handleEl.dataset.id,
        end: handleEl.dataset.end as "from" | "to" | "bend",
        moved: false,
      };
      this.viewportEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const edgeEl = target.closest<HTMLElement>(".mgn-edge-hit, .mgn-edge-label");
    if (edgeEl?.dataset.id) {
      // without this, the browser's default mousedown action blurs viewportEl
      // right after this handler runs, so a later Delete keypress never reaches
      // our keydown listener (every other branch here already does this)
      e.preventDefault();
      const id = edgeEl.dataset.id;
      const now = Date.now();
      const isDouble = this.lastClickId === id && now - this.lastClickAt < 450;
      this.lastClickAt = now;
      this.lastClickId = id;
      this.selectedEdges = new Set([id]);
      this.selection.clear();
      this.refreshSelectionClasses();
      this.drawEdges();
      if (isDouble) {
        this.lastClickId = null; // avoid triple-click re-trigger
        const edge = this.board.edges.find((x) => x.id === id);
        if (edge)
          new TextPromptModal(this.app, "Arrow label", edge.label ?? "", (v) => {
            edge.label = v || undefined;
            this.commit();
          }).open();
      }
      return;
    }

    const cardEl = target.closest<HTMLElement>(".mgn-card");
    if (cardEl?.dataset.id) {
      const id = cardEl.dataset.id;
      const it = this.item(id);
      if (!it) return;

      // Ctrl+click on a file/image/board card opens the real file in a new tab
      if (
        (e.ctrlKey || e.metaKey) &&
        (it.type === "file" || it.type === "image" || it.type === "board")
      ) {
        const f = this.resolveFile(it.path);
        if (f) this.app.workspace.getLeaf("tab").openFile(f);
        else this.relinkItem(it);
        return;
      }

      this.selectedEdges.clear();
      if (e.shiftKey) {
        if (this.selection.has(id)) this.selection.delete(id);
        else this.selection.add(id);
      } else if (!this.selection.has(id)) {
        this.selection = new Set([id]);
      }
      this.refreshSelectionClasses();

      if (it.locked) return;
      const w = this.screenToWorld(e.clientX, e.clientY);
      // card inside a column: only detach AFTER real movement (click must not detach)
      const detach = !!it.parent;
      let ids = detach
        ? [id]
        : [...this.selection].filter((sid) => !this.item(sid)?.locked && !this.item(sid)?.parent);

      // Alt+drag duplicates the selection and drags the copies
      if (e.altKey && !detach && ids.length) {
        ids = this.cloneInPlace(ids);
        this.selection = new Set(ids);
        this.render();
      }

      const orig = new Map<string, { x: number; y: number }>();
      for (const sid of ids) {
        const si = this.item(sid);
        if (si) orig.set(sid, { x: si.x, y: si.y });
      }
      this.drag = { kind: "move", ids, startWX: w.x, startWY: w.y, orig, moved: false, detach };
      this.viewportEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // empty canvas: rubber band
    this.lastDownOnCanvas = true;
    this.selection.clear();
    this.selectedEdges.clear();
    this.refreshSelectionClasses();
    this.drawEdges();
    const band = this.viewportEl.createDiv({ cls: "mgn-rubber" });
    const vr = this.viewportEl.getBoundingClientRect();
    this.drag = { kind: "rubber", startX: e.clientX - vr.left, startY: e.clientY - vr.top, el: band };
    this.viewportEl.setPointerCapture(e.pointerId);
  }

  /** clone items (incl. column children + internal edges) at the same position */
  cloneInPlace(rootIds: string[]): string[] {
    const ids = new Set(rootIds);
    for (const it of this.board.items) {
      if (it.parent && ids.has(it.parent)) ids.add(it.id);
    }
    const idMap = new Map<string, string>();
    const clones: Item[] = [];
    for (const it of this.board.items) {
      if (!ids.has(it.id)) continue;
      const n = structuredClone(it);
      const nid = newId();
      idMap.set(it.id, nid);
      n.id = nid;
      clones.push(n);
    }
    for (const n of clones) {
      if (n.parent) n.parent = idMap.get(n.parent) ?? undefined;
    }
    for (const e of this.board.edges) {
      if (e.from === undefined && e.to === undefined) continue; // free line, not tied to items
      if ((e.from && !idMap.has(e.from)) || (e.to && !idMap.has(e.to))) continue;
      this.board.edges.push({
        ...structuredClone(e),
        id: newId(),
        from: e.from ? idMap.get(e.from) : undefined,
        to: e.to ? idMap.get(e.to) : undefined,
      });
    }
    this.board.items.push(...clones);
    return rootIds.map((id) => idMap.get(id)!).filter(Boolean);
  }

  onPointerMove(e: PointerEvent) {
    // throttle: heavy work (layout reads + edge redraw) at most once per frame
    if (this.drag.kind === "none") return;
    this.lastMoveEvent = e;
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (this.lastMoveEvent && this.drag.kind !== "none") {
        this.processPointerMove(this.lastMoveEvent);
      }
    });
  }

  /** effective grid snap: setting XOR Ctrl (Ctrl temporarily inverts the mode) */
  private snapStep(e: PointerEvent): number {
    const invert = e.ctrlKey || e.metaKey;
    const on = this.plugin.settings.gridSnap !== invert;
    return on ? this.plugin.settings.gridSize : 0;
  }

  processPointerMove(e: PointerEvent) {
    const d = this.drag;
    switch (d.kind) {
      case "pan": {
        this.panX = d.panX + (e.clientX - d.startX);
        this.panY = d.panY + (e.clientY - d.startY);
        this.applyTransform();
        break;
      }
      case "move": {
        const w = this.screenToWorld(e.clientX, e.clientY);
        let dx = w.x - d.startWX;
        let dy = w.y - d.startWY;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          d.moved = true;
          if (d.detach) {
            const it = this.item(d.ids[0]);
            if (it) {
              it.parent = undefined;
              it.order = undefined;
              it.x = w.x - it.w / 2;
              it.y = w.y - 16;
              d.orig.set(it.id, { x: it.x, y: it.y });
              d.startWX = w.x;
              d.startWY = w.y;
              dx = 0;
              dy = 0;
              this.render();
            }
          }
        }
        if (!d.moved) break;
        const snap = this.snapStep(e);
        for (const id of d.ids) {
          const it = this.item(id);
          const o = d.orig.get(id);
          if (!it || !o) continue;
          it.x = o.x + dx;
          it.y = o.y + dy;
          if (snap) {
            it.x = Math.round(it.x / snap) * snap;
            it.y = Math.round(it.y / snap) * snap;
          }
          const el = this.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${id}"]`);
          if (el) {
            el.style.left = `${it.x}px`;
            el.style.top = `${it.y}px`;
          }
        }
        this.highlightColumnUnder(e, d.ids);
        if (this.board.edges.length) this.drawEdges();
        break;
      }
      case "rubber": {
        const vr = this.viewportEl.getBoundingClientRect();
        const x = e.clientX - vr.left, y = e.clientY - vr.top;
        const rx = Math.min(x, d.startX), ry = Math.min(y, d.startY);
        const rw = Math.abs(x - d.startX), rh = Math.abs(y - d.startY);
        Object.assign(d.el.style, { left: rx + "px", top: ry + "px", width: rw + "px", height: rh + "px" });
        const wp1 = this.screenToWorld(vr.left + rx, vr.top + ry);
        const wp2 = this.screenToWorld(vr.left + rx + rw, vr.top + ry + rh);
        const rects = this.cardWorldRects();
        this.selection.clear();
        for (const it of this.board.items) {
          if (it.parent) continue;
          const r = rects.get(it.id);
          if (!r) continue;
          if (r.x < wp2.x && r.x + r.w > wp1.x && r.y < wp2.y && r.y + r.h > wp1.y)
            this.selection.add(it.id);
        }
        // a line is selected when any part of it touches the band (same
        // "touches" semantic as cards above, not full enclosure)
        this.selectedEdges.clear();
        const endPoint = (id: string | undefined, pt: { x: number; y: number } | undefined) => {
          if (pt) return pt;
          const r = id ? rects.get(id) : undefined;
          return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
        };
        for (const ed of this.board.edges) {
          const p1 = endPoint(ed.from, ed.fromPt);
          const p2 = endPoint(ed.to, ed.toPt);
          if (p1 && p2 && segmentIntersectsRect(p1.x, p1.y, p2.x, p2.y, wp1.x, wp1.y, wp2.x, wp2.y))
            this.selectedEdges.add(ed.id);
        }
        this.refreshSelectionClasses();
        this.drawEdges();
        break;
      }
      case "resize": {
        const it = this.item(d.id);
        if (!it) break;
        const w = this.screenToWorld(e.clientX, e.clientY);
        const snap = this.snapStep(e);
        it.w = Math.max(120, d.w0 + (w.x - d.startWX));
        it.h = Math.max(48, d.h0 + (w.y - d.startWY));
        if (snap) {
          it.w = Math.max(120, Math.round(it.w / snap) * snap);
          it.h = Math.max(48, Math.round(it.h / snap) * snap);
        }
        const el = this.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${d.id}"]`);
        if (el) {
          el.style.width = `${it.w}px`;
          el.style.minHeight = `${it.h}px`;
        }
        this.drawEdges();
        break;
      }
      case "connect": {
        const rects = this.cardWorldRects();
        const a = rects.get(d.from);
        if (!a) break;
        const w = this.screenToWorld(e.clientX, e.clientY);
        const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2;
        d.tempPath.setAttr("d", `M ${x1} ${y1} L ${w.x} ${w.y}`);
        d.tempPath.setAttr("marker-end", "url(#mgn-arrowhead)");
        break;
      }
      case "line-end": {
        const edge = this.board.edges.find((x) => x.id === d.id);
        if (!edge) break;
        d.moved = true;
        const w = this.screenToWorld(e.clientX, e.clientY);
        if (d.end === "bend") {
          edge.bend = { x: w.x, y: w.y };
        } else {
          // detach from any anchored card and follow the pointer as a free end
          if (d.end === "from") { edge.from = undefined; edge.fromPt = { x: w.x, y: w.y }; }
          else { edge.to = undefined; edge.toPt = { x: w.x, y: w.y }; }
          this.highlightCardUnder(e);
        }
        this.drawEdges();
        break;
      }
    }
  }

  onPointerUp(e: PointerEvent) {
    // flush the last pointer position (throttled moves may lag one frame)
    if (this.drag.kind !== "none") this.processPointerMove(e);
    const d = this.drag;
    this.drag = { kind: "none" };
    this.lastMoveEvent = null;
    switch (d.kind) {
      case "move": {
        this.clearColumnHighlight();
        if (!d.moved) {
          // pointer capture retargets native dblclick to the viewport, so we
          // detect card double-clicks manually here
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && d.ids.length === 1) {
            const it = this.item(d.ids[0]);
            if (it) {
              const now = Date.now();
              const isDouble = this.lastClickId === it.id && now - this.lastClickAt < 450;
              this.lastClickAt = now;
              this.lastClickId = it.id;
              if (isDouble) {
                this.lastClickId = null; // avoid triple-click re-trigger
                this.openCard(it);
              }
            }
          }
          break;
        }
        // dropped over a column?
        if (d.ids.length === 1) {
          const col = this.columnUnder(e, d.ids);
          const it = this.item(d.ids[0]);
          if (col && it && it.type !== "column" && col.id !== it.id) {
            const siblings = this.board.items
              .filter((c) => c.parent === col.id)
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const rects = this.cardWorldRects();
            const wy = this.screenToWorld(e.clientX, e.clientY).y;
            let ord = siblings.length;
            for (let i = 0; i < siblings.length; i++) {
              const sr = rects.get(siblings[i].id);
              if (sr && wy < sr.y + sr.h / 2) { ord = i; break; }
            }
            it.parent = col.id;
            siblings.splice(ord, 0, it);
            siblings.forEach((s, i) => (s.order = i));
          }
        }
        this.commit();
        break;
      }
      case "rubber": {
        d.el.remove();
        break;
      }
      case "resize": {
        this.commit();
        break;
      }
      case "connect": {
        d.tempPath.remove();
        const to = this.cardIdUnder(e);
        if (to && to !== d.from) {
          this.board.edges.push({ id: newId(), from: d.from, to, arrow: true, mode: "free" });
          this.commit();
        } else if (to === d.from) {
          this.drawEdges();
        } else {
          // dropped on empty canvas: create a line with a free end
          const w = this.screenToWorld(e.clientX, e.clientY);
          this.board.edges.push({ id: newId(), from: d.from, toPt: { x: w.x, y: w.y }, arrow: true, mode: "free" });
          this.commit();
        }
        break;
      }
      case "line-end": {
        this.clearCardHighlight();
        if (!d.moved) { this.drawEdges(); break; }
        const edge = this.board.edges.find((x) => x.id === d.id);
        if (edge && d.end !== "bend") {
          const over = this.cardIdUnder(e);
          if (over) {
            // anchor this end to the card under the pointer
            if (d.end === "from") { edge.from = over; edge.fromPt = undefined; }
            else { edge.to = over; edge.toPt = undefined; }
          }
        }
        this.commit();
        break;
      }
    }
  }

  /** id of the topmost card under the pointer, or null over empty canvas */
  cardIdUnder(e: PointerEvent | MouseEvent): string | null {
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    return under?.closest<HTMLElement>(".mgn-card")?.dataset.id ?? null;
  }

  highlightCardUnder(e: PointerEvent) {
    this.clearCardHighlight();
    const id = this.cardIdUnder(e);
    if (id) this.worldEl.querySelector(`.mgn-card[data-id="${id}"]`)?.addClass("mgn-conn-target");
  }

  clearCardHighlight() {
    this.worldEl.querySelectorAll(".mgn-conn-target").forEach((el) => el.removeClass("mgn-conn-target"));
  }

  columnUnder(e: PointerEvent, draggedIds: string[]): Item | null {
    const dragged = new Set(draggedIds);
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els) {
      const card = (el as HTMLElement).closest?.(".mgn-card") as HTMLElement | null;
      if (!card?.dataset.id || dragged.has(card.dataset.id)) continue;
      const it = this.item(card.dataset.id);
      if (it?.type === "column") return it;
      if (it?.parent) {
        const parent = this.item(it.parent);
        if (parent?.type === "column") return parent;
      }
    }
    return null;
  }

  highlightColumnUnder(e: PointerEvent, ids: string[]) {
    this.clearColumnHighlight();
    if (ids.length !== 1) return;
    const it = this.item(ids[0]);
    if (!it || it.type === "column") return;
    const col = this.columnUnder(e, ids);
    if (col) {
      this.worldEl
        .querySelector(`.mgn-card[data-id="${col.id}"]`)
        ?.addClass("mgn-col-target");
    }
  }

  clearColumnHighlight() {
    this.worldEl.querySelectorAll(".mgn-col-target").forEach((el) => el.removeClass("mgn-col-target"));
  }

  refreshSelectionClasses() {
    this.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
      el.toggleClass("mgn-selected", this.selection.has(el.dataset.id ?? ""));
    });
  }

  onWheel(e: WheelEvent) {
    if (this.drawMode) { e.preventDefault(); return; } // lock view while drawing
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.setZoom(this.zoom * factor, e.clientX, e.clientY);
    } else {
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this.applyTransform();
    }
  }

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

  onContextMenu(e: MouseEvent) {
    if (this.drawMode) { e.preventDefault(); return; }
    const target = e.target as HTMLElement;
    const edgeEl = target.closest<HTMLElement>(".mgn-edge-hit, .mgn-edge-label");
    if (edgeEl?.dataset.id) {
      e.preventDefault();
      const edge = this.board.edges.find((x) => x.id === edgeEl.dataset.id);
      if (!edge) return;
      const menu = new Menu();
      menu.addItem((i) => {
        i.setTitle("Line color").setIcon("palette");
        const sub = (i as any).setSubmenu?.() as Menu | undefined;
        if (sub) {
          for (const c of CARD_COLORS) {
            sub.addItem((si) =>
              si.setTitle(c.name).setChecked(colorOf(edge.color).key === c.key).onClick(() => {
                edge.color = c.key;
                this.commit();
              })
            );
          }
        } else {
          i.onClick(() => {
            const idx = CARD_COLORS.findIndex((c) => c.key === colorOf(edge.color).key);
            edge.color = CARD_COLORS[(idx + 1) % CARD_COLORS.length].key;
            this.commit();
          });
        }
      });
      menu.addItem((i) => i.setTitle("Edit label").setIcon("pencil").onClick(() => {
        new TextPromptModal(this.app, "Arrow label", edge.label ?? "", (v) => {
          edge.label = v || undefined;
          this.commit();
        }).open();
      }));
      menu.addItem((i) => i.setTitle(edge.arrow === false ? "Show arrowhead" : "Remove arrowhead").setIcon("move-right").onClick(() => {
        edge.arrow = edge.arrow === false ? true : false;
        this.commit();
      }));
      menu.addItem((i) => i.setTitle(edge.dashed ? "Solid line" : "Dashed line").setIcon("minus").onClick(() => {
        edge.dashed = !edge.dashed;
        this.commit();
      }));
      menu.addItem((i) => i.setTitle("Reverse direction").setIcon("arrow-left-right").onClick(() => {
        [edge.from, edge.to] = [edge.to, edge.from];
        [edge.fromPt, edge.toPt] = [edge.toPt, edge.fromPt];
        this.commit();
      }));
      menu.addItem((i) => {
        const isFree = (edge.mode ?? "smart") === "free";
        i.setTitle(isFree ? "Switch to Smart routing" : "Switch to Free line").setIcon("route").onClick(() => {
          edge.mode = isFree ? "smart" : "free";
          if (edge.mode === "smart") edge.bend = undefined; // bend curve only applies to Free
          this.commit();
        });
      });
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Delete arrow").setIcon("trash").onClick(() => {
        this.board.edges = this.board.edges.filter((x) => x.id !== edge.id);
        this.commit();
      }));
      menu.showAtMouseEvent(e);
      return;
    }

    const cardEl = target.closest<HTMLElement>(".mgn-card");
    if (!cardEl?.dataset.id) return;
    e.preventDefault();
    const it = this.item(cardEl.dataset.id);
    if (!it) return;
    if (!this.selection.has(it.id)) {
      this.selection = new Set([it.id]);
      this.refreshSelectionClasses();
    }
    const menu = new Menu();
    if (it.type !== "swatch" && it.type !== "column") {
      menu.addItem((i) => {
        i.setTitle("Card color").setIcon("palette");
        const sub = (i as any).setSubmenu?.() as Menu | undefined;
        if (sub) {
          for (const c of CARD_COLORS) {
            sub.addItem((si) =>
              si.setTitle(c.name).setChecked(colorOf(it.color).key === c.key).onClick(() => {
                for (const id of this.selection) {
                  const t = this.item(id);
                  if (t) t.color = c.key;
                }
                this.commit();
              })
            );
          }
        } else {
          i.onClick(() => {
            const idx = CARD_COLORS.findIndex((c) => c.key === colorOf(it.color).key);
            it.color = CARD_COLORS[(idx + 1) % CARD_COLORS.length].key;
            this.commit();
          });
        }
      });
    }
    if (it.type === "file" || it.type === "image" || it.type === "board") {
      menu.addItem((i) =>
        i.setTitle("Replace reference...").setIcon("link-2").onClick(() => this.relinkItem(it))
      );
    }
    if (it.type === "record" && it.path) {
      menu.addItem((i) =>
        i.setTitle("Transcribe text").setIcon("captions").onClick(() => this.transcribeRecord(it))
      );
    }
    menu.addItem((i) => i.setTitle(it.locked ? "Unlock" : "Lock on board").setIcon(it.locked ? "unlock" : "lock").onClick(() => {
      it.locked = !it.locked;
      this.commit();
    }));
    menu.addItem((i) => i.setTitle("Duplicate (Ctrl+D)").setIcon("copy").onClick(() => this.duplicateSelection()));
    menu.addItem((i) => i.setTitle("Bring to front").setIcon("arrow-up").onClick(() => {
      const idx = this.board.items.findIndex((x) => x.id === it.id);
      const [moved] = this.board.items.splice(idx, 1);
      this.board.items.push(moved);
      this.commit();
    }));
    menu.addItem((i) => i.setTitle("Send to back").setIcon("arrow-down").onClick(() => {
      const idx = this.board.items.findIndex((x) => x.id === it.id);
      const [moved] = this.board.items.splice(idx, 1);
      this.board.items.unshift(moved);
      this.commit();
    }));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Delete").setIcon("trash").onClick(() => this.deleteSelection()));
    menu.showAtMouseEvent(e);
  }

  onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const editing =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    if (e.code === "Space" && !editing) {
      this.spaceDown = true;
      return;
    }
    if (editing) return;

    const kb = this.plugin.settings.keybindings;

    if (this.drawMode) {
      if (e.key === "Escape") { e.preventDefault(); this.exitDrawMode(false); return; }
      if (matchesBinding(e, kb.undo)) { e.preventDefault(); this.drawMode.session.undo(); return; }
      if (matchesBinding(e, kb.redo)) { e.preventDefault(); this.drawMode.session.redo(); return; }
      return; // swallow board shortcuts while drawing
    }

    if (matchesBinding(e, kb.undo)) { e.preventDefault(); this.undo(); return; }
    if (matchesBinding(e, kb.redo)) { e.preventDefault(); this.redo(); return; }
    if (matchesBinding(e, kb.duplicate)) { e.preventDefault(); this.duplicateSelection(); return; }
    if (matchesBinding(e, kb.copy)) { e.preventDefault(); this.copySelection(false); return; }
    if (matchesBinding(e, kb.cut)) { e.preventDefault(); this.copySelection(true); return; }
    if (matchesBinding(e, kb.paste)) { this.pasteInternal(); return; }
    if (matchesBinding(e, kb.selectAll)) { e.preventDefault(); this.selection = new Set(this.board.items.filter((i) => !i.parent).map((i) => i.id)); this.refreshSelectionClasses(); return; }
    if (matchesBinding(e, kb.search)) { e.preventDefault(); this.openSearch(); return; }
    if (matchesBinding(e, kb.drawMode)) { this.enterDrawMode(); return; }
    if (matchesBinding(e, kb.zoomReset)) { e.preventDefault(); this.setZoom(1); return; }

    if (matchesBinding(e, kb.deleteSelection) || e.key === "Backspace") {
      e.preventDefault();
      if (this.selectedEdges.size) {
        this.board.edges = this.board.edges.filter((x) => !this.selectedEdges.has(x.id));
        this.selectedEdges.clear();
        this.commit();
      } else {
        this.deleteSelection();
      }
      return;
    }
    if (e.key === "Escape") {
      this.closePreview();
      this.selection.clear();
      this.selectedEdges.clear();
      this.contentEl.querySelector(".mgn-toolbar .mgn-tool-active")?.removeClass("mgn-tool-active");
      this.refreshSelectionClasses();
      this.drawEdges();
      this.closeSearch();
      return;
    }
    // nudge
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && this.selection.size) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      for (const id of this.selection) {
        const it = this.item(id);
        if (it && !it.locked && !it.parent) { it.x += dx; it.y += dy; }
      }
      this.commit();
      return;
    }
  }

  // ------------------------------------------------------------- add items
  private placed(x?: number, y?: number) {
    const c = this.viewCenter();
    return { x: x ?? c.x - 120, y: y ?? c.y - 60 };
  }

  addItem(partial: Partial<Item> & { type: Item["type"] }, x?: number, y?: number): Item {
    const p = this.placed(x, y);
    const it: Item = {
      id: newId(),
      x: p.x,
      y: p.y,
      w: this.plugin.settings.defaultNoteWidth,
      ...partial,
    } as Item;
    this.board.items.push(it);
    this.selection = new Set([it.id]);
    this.commit();
    return it;
  }

  addNote(x?: number, y?: number, edit = false) {
    const it = this.addItem({ type: "note", text: "" }, x, y);
    if (edit)
      window.setTimeout(() => {
        const el = this.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${it.id}"]`);
        if (el) this.editNote(it, el);
      }, 30);
  }

  addTodo(x?: number, y?: number) {
    this.addItem({ type: "todo", title: "To-do", todos: [] }, x, y);
  }

  addColumn(x?: number, y?: number) {
    this.addItem({ type: "column", title: "Column", w: 300 }, x, y);
  }

  addSwatch(x?: number, y?: number) {
    this.addItem({ type: "swatch", swatch: "#31303b", w: 160 }, x, y);
  }

  addComment(x?: number, y?: number) {
    this.addItem({ type: "comment", text: "", color: "yellow" }, x, y);
  }

  addRecord(x?: number, y?: number) {
    this.addItem({ type: "record", w: 220, h: 80 }, x, y);
  }

  createFromTool(key: string, x: number, y: number) {
    switch (key) {
      case "note": this.addNote(x, y, true); break;
      case "todo": this.addTodo(x, y); break;
      case "column": this.addColumn(x, y); break;
      case "swatch": this.addSwatch(x, y); break;
      case "comment": this.addComment(x, y); break;
      case "sketch": this.addSketch(x, y); break;
      case "record": this.addRecord(x, y); break;
      case "line": this.addLine(x, y); break;
      case "link": this.promptLink({ x, y }); break;
      case "board": this.promptBoard({ x, y }); break;
      case "image":
        this.pendingPos = { x, y };
        this.imgInput.click();
        break;
      case "file":
        this.pendingPos = { x, y };
        new VaultFilePicker(this.app, (f) => this.addVaultFile(f)).open();
        break;
    }
  }

  /** drop a standalone line centered on (x, y); both ends free, selected */
  addLine(x: number, y: number) {
    const half = 80;
    const edge: Edge = {
      id: newId(),
      fromPt: { x: x - half, y },
      toPt: { x: x + half, y },
      arrow: true,
      mode: "free",
    };
    this.board.edges.push(edge);
    this.selection.clear();
    this.selectedEdges = new Set([edge.id]);
    this.refreshSelectionClasses();
    this.commit();
  }

  promptLink(pos?: { x: number; y: number }) {
    new TextPromptModal(this.app, "Link URL", "https://", async (url) => {
      if (!url || url === "https://") return;
      const it = this.addItem({ type: "link", url, title: url.replace(/^https?:\/\//, "") }, pos?.x, pos?.y);
      try {
        const res = await requestUrl({ url });
        const m = res.text.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (m?.[1]) {
          it.title = m[1].trim();
          this.commit();
        }
      } catch { /* offline or blocked — keep url as title */ }
    }).open();
  }

  promptBoard(pos?: { x: number; y: number }) {
    new TextPromptModal(this.app, "New board name", "New board", async (name) => {
      if (!name) return;
      const folder = this.file?.parent?.path ?? "";
      const prefix = folder && folder !== "/" ? folder + "/" : "";
      let path = normalizePath(`${prefix}${name}.board`);
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = normalizePath(`${prefix}${name} ${i++}.board`);
      }
      await this.app.vault.create(path, JSON.stringify({ version: 1, items: [], edges: [] }, null, 2));
      this.addItem({ type: "board", path, title: name, w: 220 }, pos?.x, pos?.y);
    }).open();
  }

  addVaultFile(f: TFile) {
    const c = this.pendingPos ?? this.viewCenter();
    this.pendingPos = null;
    this.addVaultFileAt(f, c.x, c.y);
  }

  addVaultFileAt(f: TFile, x: number, y: number) {
    if (IMAGE_EXTS.includes(f.extension.toLowerCase())) {
      this.addItem({ type: "image", path: f.path, w: 280 }, x - 140, y - 100);
    } else if (f.extension === "board") {
      this.addItem({ type: "board", path: f.path, title: f.basename, w: 220 }, x, y);
    } else {
      this.addItem({ type: "file", path: f.path, title: f.name, w: 260 }, x, y);
    }
  }

  // ------------------------------------------------------ clipboard & dupes
  copySelection(cut: boolean) {
    if (!this.selection.size) return;
    const ids = new Set(this.selection);
    for (const it of this.board.items) {
      if (it.parent && ids.has(it.parent)) ids.add(it.id);
    }
    const items = this.board.items.filter((i) => ids.has(i.id)).map((i) => structuredClone(i));
    const edges = this.board.edges
      .filter((e) => !!e.from && !!e.to && ids.has(e.from) && ids.has(e.to))
      .map((e) => structuredClone(e));
    this.plugin.clipboard = { items, edges };
    if (cut) {
      this.board.items = this.board.items.filter((i) => !ids.has(i.id));
      this.board.edges = this.board.edges.filter((e) => !(e.from && ids.has(e.from)) && !(e.to && ids.has(e.to)));
      this.selection.clear();
      this.commit();
    }
    new Notice(cut ? "Cut" : "Copied");
  }

  pasteInternal() {
    const clip = this.plugin.clipboard;
    if (!clip?.items.length) return;
    const idMap = new Map<string, string>();
    const clones: Item[] = clip.items.map((i) => {
      const n = structuredClone(i);
      const nid = newId();
      idMap.set(i.id, nid);
      n.id = nid;
      return n;
    });
    for (const n of clones) {
      if (n.parent) n.parent = idMap.get(n.parent) ?? undefined;
      if (!n.parent) { n.x += 30; n.y += 30; }
    }
    for (const e of clip.edges) {
      const nf = e.from ? idMap.get(e.from) : undefined;
      const nt = e.to ? idMap.get(e.to) : undefined;
      if (nf && nt) this.board.edges.push({ ...structuredClone(e), id: newId(), from: nf, to: nt });
    }
    this.board.items.push(...clones);
    this.selection = new Set(clones.filter((c) => !c.parent).map((c) => c.id));
    this.commit();
  }

  duplicateSelection() {
    if (!this.selection.size) return;
    const saved = this.plugin.clipboard;
    this.copySelection(false);
    this.pasteInternal();
    this.plugin.clipboard = saved;
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const ids = new Set(this.selection);
    for (const it of this.board.items) {
      if (it.parent && ids.has(it.parent)) ids.add(it.id);
    }
    this.board.items = this.board.items.filter((i) => !ids.has(i.id));
    this.board.edges = this.board.edges.filter((e) => !(e.from && ids.has(e.from)) && !(e.to && ids.has(e.to)));
    this.selection.clear();
    this.commit();
  }

  // --------------------------------------------------------- import / drop
  async onDrop(e: DragEvent) {
    e.preventDefault();
    const w = this.screenToWorld(e.clientX, e.clientY);

    // drag from the left toolbar creates the element at the drop point
    const toolKey = e.dataTransfer?.getData("mgn-tool");
    if (toolKey) {
      this.createFromTool(toolKey, w.x, w.y);
      return;
    }

    // drag from Obsidian's file explorer (internal drag manager)
    const dm = (this.app as any).dragManager;
    const draggable = dm?.draggable;
    if (draggable) {
      const files: TFile[] = [];
      if (draggable.type === "file" && draggable.file instanceof TFile) files.push(draggable.file);
      if (draggable.type === "files" && Array.isArray(draggable.files)) {
        for (const f of draggable.files) if (f instanceof TFile) files.push(f);
      }
      if (files.length) {
        let off = 0;
        for (const f of files) {
          this.addVaultFileAt(f, w.x + off, w.y + off);
          off += 30;
        }
        return;
      }
    }

    // files dragged from the OS
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) {
      let off = 0;
      for (const f of files) {
        await this.importOsFile(f, w.x + off, w.y + off);
        off += 30;
      }
      return;
    }

    const text = e.dataTransfer?.getData("text/plain");
    if (text) {
      // a dropped wiki-style path from Obsidian resolves to a vault file
      const linked = this.app.metadataCache.getFirstLinkpathDest(
        text.replace(/^\[\[|\]\]$/g, "").trim(),
        this.file?.path ?? ""
      );
      if (linked) {
        this.addVaultFileAt(linked, w.x, w.y);
        return;
      }
      if (/^https?:\/\//.test(text.trim())) {
        this.addItem({ type: "link", url: text.trim(), title: text.trim().replace(/^https?:\/\//, "") }, w.x, w.y);
      } else {
        this.addItem({ type: "note", text }, w.x, w.y);
      }
    }
  }

  async onPaste(e: ClipboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true]")) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      const c = this.viewCenter();
      let off = 0;
      for (const f of files) {
        await this.importOsFile(f, c.x + off, c.y + off);
        off += 30;
      }
      return;
    }
    const text = e.clipboardData?.getData("text/plain");
    if (text && !this.plugin.clipboard) {
      e.preventDefault();
      const c = this.viewCenter();
      if (/^https?:\/\/\S+$/.test(text.trim())) {
        this.addItem({ type: "link", url: text.trim(), title: text.trim().replace(/^https?:\/\//, "") }, c.x, c.y);
      } else {
        this.addItem({ type: "note", text }, c.x, c.y);
      }
    }
  }

  async importOsFile(f: File, x: number, y: number) {
    const buf = await f.arrayBuffer();
    const folder = this.file?.parent?.path && this.file.parent.path !== "/"
      ? this.file.parent.path + "/assets"
      : "assets";
    const base = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(base)) {
      await this.app.vault.createFolder(base).catch(() => {});
    }
    const safe = f.name.replace(/[\\/:*?"<>|]/g, "-") || "file";
    let path = normalizePath(`${base}/${safe}`);
    let i = 1;
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : "";
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${base}/${stem}-${i++}${ext}`);
    }
    const tf = await this.app.vault.createBinary(path, buf);
    const lower = tf.extension.toLowerCase();
    if (IMAGE_EXTS.includes(lower)) {
      this.addItem({ type: "image", path: tf.path, w: 280 }, x, y);
    } else {
      this.addItem({ type: "file", path: tf.path, title: tf.name, w: 260 }, x, y);
    }
  }

  /** save a binary blob into the board's assets folder, returning the created file */
  private async saveAssetBinary(filename: string, buf: ArrayBuffer): Promise<TFile> {
    const folder = this.file?.parent?.path && this.file.parent.path !== "/"
      ? this.file.parent.path + "/assets"
      : "assets";
    const base = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(base)) {
      await this.app.vault.createFolder(base).catch(() => {});
    }
    const safe = filename.replace(/[\\/:*?"<>|]/g, "-") || "recording.webm";
    let path = normalizePath(`${base}/${safe}`);
    let i = 1;
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : "";
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${base}/${stem}-${i++}${ext}`);
    }
    return this.app.vault.createBinary(path, buf);
  }

  /** popup recorder for a record card: pick mic, record, save as vault audio file */
  openRecordPopup(it: Item) {
    this.closePreview();
    const ov = this.contentEl.createDiv({ cls: "mgn-preview" });
    const panel = ov.createDiv({ cls: "mgn-preview-panel mgn-record-panel" });
    const head = panel.createDiv({ cls: "mgn-preview-head" });
    head.createDiv({ cls: "mgn-preview-crumbs" }).createSpan({ cls: "mgn-crumb-current", text: "Record" });
    const body = panel.createDiv({ cls: "mgn-preview-body mgn-record-body" });

    const micRow = body.createDiv({ cls: "mgn-record-mic-row" });
    micRow.createSpan({ text: "Microphone: " });
    const micSelect = micRow.createEl("select", { cls: "dropdown" });

    const status = body.createDiv({ cls: "mgn-record-status", text: "Ready" });
    const viz = body.createEl("canvas", { cls: "mgn-record-viz", attr: { width: "280", height: "56" } });
    const vizCtx = viz.getContext("2d");
    const timer = body.createDiv({ cls: "mgn-record-timer", text: "00:00" });
    let existingAudio: HTMLAudioElement | null = null;
    if (it.path) {
      const f = this.resolveFile(it.path);
      if (f) {
        existingAudio = body.createEl("audio", { attr: { controls: "true" } });
        existingAudio.src = this.app.vault.getResourcePath(f as TFile);
      }
    }

    const btnRow = body.createDiv({ cls: "mgn-record-btn-row" });
    const recordBtn = btnRow.createEl("button", { text: it.path ? "Record again" : "Record" });
    const stopBtn = btnRow.createEl("button", { text: "Stop" });
    stopBtn.disabled = true;

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: BlobPart[] = [];
    let startedAt = 0;
    let timerHandle: number | undefined;
    let newBlob: Blob | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let vizFrame: number | undefined;

    const stopTimer = () => { if (timerHandle) window.clearInterval(timerHandle); timerHandle = undefined; };
    const stopStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    const stopViz = () => {
      if (vizFrame) cancelAnimationFrame(vizFrame);
      vizFrame = undefined;
      audioCtx?.close();
      audioCtx = null;
      analyser = null;
      vizCtx?.clearRect(0, 0, viz.width, viz.height);
    };
    const drawViz = () => {
      if (!analyser || !vizCtx) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      vizCtx.clearRect(0, 0, viz.width, viz.height);
      const barCount = 32;
      const step = Math.floor(data.length / barCount);
      const barW = viz.width / barCount;
      const style = getComputedStyle(viz);
      vizCtx.fillStyle = style.color || "#888";
      for (let i = 0; i < barCount; i++) {
        // deviation from silence (128) across this bar's slice, as a 0..1 level
        let peak = 0;
        for (let j = 0; j < step; j++) {
          peak = Math.max(peak, Math.abs(data[i * step + j] - 128) / 128);
        }
        const h = Math.max(2, peak * viz.height);
        vizCtx.fillRect(i * barW + 1, (viz.height - h) / 2, barW - 2, h);
      }
      vizFrame = requestAnimationFrame(drawViz);
    };

    const populateMics = async () => {
      micSelect.empty();
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      for (const d of mics) {
        micSelect.createEl("option", { value: d.deviceId, text: d.label || "Microphone" });
      }
      const preferred = this.plugin.settings.defaultMicId;
      if (preferred && mics.some((d) => d.deviceId === preferred)) micSelect.value = preferred;
    };
    populateMics().catch(() => { status.setText("Could not list microphones"); });

    const finish = () => {
      stopTimer();
      stopViz();
      stopStream();
      recorder?.stop();
      recorder = null;
      document.removeEventListener("keydown", keyHandler, true);
      ov.remove();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    document.addEventListener("keydown", keyHandler, true);
    ov.addEventListener("pointerdown", (e) => { if (e.target === ov) finish(); });

    recordBtn.addEventListener("click", async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micSelect.value ? { deviceId: { exact: micSelect.value } } : true,
        });
      } catch {
        status.setText("Microphone access denied");
        return;
      }
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        newBlob = new Blob(chunks, { type: "audio/webm" });
        const buf = await newBlob.arrayBuffer();
        const tf = await this.saveAssetBinary("recording.webm", buf);
        it.path = tf.path;
        it.duration = Math.round((Date.now() - startedAt) / 1000);
        this.commit(false);
        this.rerenderItem(it);
        status.setText("Saved");
        finish();
      };
      recorder.start();
      startedAt = Date.now();
      status.setText("Recording…");
      recordBtn.disabled = true;
      stopBtn.disabled = false;

      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      drawViz();
      timerHandle = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        timer.setText(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
      }, 250);
    });

    stopBtn.addEventListener("click", () => {
      stopTimer();
      stopViz();
      stopStream();
      recorder?.stop();
      recordBtn.disabled = false;
      stopBtn.disabled = true;
    });
  }

  /** transcribe a record card's audio via the OpenAI Whisper API, dropping the
   * result into a new note card connected back to the recording */
  async transcribeRecord(it: Item) {
    const apiKey = this.plugin.getOpenAiApiKey();
    if (!apiKey) {
      new Notice("Set an OpenAI API key in Settings → Recording first");
      return;
    }
    const f = this.resolveFile(it.path);
    if (!f) {
      new Notice("Recording file not found");
      return;
    }
    new Notice("Transcribing...");
    let text: string;
    try {
      const buf = await this.app.vault.readBinary(f);
      const form = new FormData();
      form.append("file", new Blob([buf], { type: "audio/webm" }), f.name);
      form.append("model", "whisper-1");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data = await res.json();
      text = (data.text ?? "").trim();
    } catch (err) {
      new Notice(`Transcription failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!text) {
      new Notice("Transcription returned no text");
      return;
    }
    const note = this.addItem({ type: "note", text, w: this.plugin.settings.defaultNoteWidth }, it.x + it.w + 60, it.y);
    this.board.edges.push({ id: newId(), from: it.id, to: note.id, arrow: true, mode: "free" });
    this.commit();
  }

  // ---------------------------------------------------------------- search
  openSearch() {
    this.searchEl.show();
    this.searchInput.focus();
    this.searchInput.select();
  }

  closeSearch() {
    this.searchEl.hide();
    this.searchInput.value = "";
    this.runSearch("");
    this.viewportEl.focus();
  }

  runSearch(q: string) {
    q = q.toLowerCase().trim();
    this.searchHits = [];
    this.searchIdx = 0;
    this.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
      el.removeClass("mgn-dim", "mgn-hit");
    });
    if (!q) return;
    const matches = (it: Item) =>
      [it.text, it.title, it.url, it.path, it.swatch, ...(it.todos ?? []).map((t) => t.text)]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    for (const it of this.board.items) {
      if (matches(it)) this.searchHits.push(it.id);
    }
    const hitSet = new Set(this.searchHits);
    this.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
      const id = el.dataset.id ?? "";
      el.toggleClass("mgn-hit", hitSet.has(id));
      el.toggleClass("mgn-dim", !hitSet.has(id));
    });
    if (this.searchHits.length) this.centerOn(this.searchHits[0]);
  }
}
