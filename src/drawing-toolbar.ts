import type { BoardView } from "./board-view";
import { ContextToolbar, CtxGroup, DrawSession, DrawTool, groupStrokes } from "./draw";
import { DRAW_GROUP_DISTANCE, Item, STROKE_SIZES, newId } from "./types";

// fixed pen-ink palette for the Draw/Sketch color picker — intentionally not
// theme-dependent (see renderColorControl)
export const DRAW_SWATCHES = [
  "#33343d", "#fff5c0", "#ffd9b0", "#ffc7c2", "#e2cbf7",
  "#c4ddff", "#bdede0", "#d3f2c0", "#e4e4e8", "#ffffff",
];

/** shared contextual toolbar for board draw mode and the sketch popup */
function makeDrawToolbar(
  view: BoardView,
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
      { id: "select", icon: "mouse-pointer-2", label: "Select", onClick: () => setTool("select") },
      { id: "eraser", icon: "eraser", label: "Eraser", onClick: () => setTool("eraser") },
    ],
    [
      { render: (h) => renderColorControl(view, h, session) },
      { render: (h) => renderSizeControl(view, h, session) },
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
  bar = new ContextToolbar(host, view.tbEl, groups, inline);
  setTool("pen");
  return bar;
}

/** popover anchored to a toolbar button; closes on outside click */
export function makePopover(view: BoardView, anchor: HTMLElement): HTMLElement {
  view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
  const pop = view.contentEl.createDiv({ cls: "mgn-ctx-popover" });
  const cr = view.contentEl.getBoundingClientRect();
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
function renderColorControl(view: BoardView, h: HTMLElement, session: DrawSession) {
  const btn = h.createDiv({ cls: "mgn-ctx-tool mgn-ctx-swatchbtn", attr: { "aria-label": "Color" } });
  const dot = btn.createDiv({ cls: "mgn-ctx-colordot" });
  dot.style.background = session.color;
  const pick = (c: string, close = true) => {
    session.color = c;
    session.recolorSelection(c);
    dot.style.background = c;
    if (close) view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
  };
  btn.addEventListener("click", () => {
    if (view.contentEl.querySelector(".mgn-ctx-popover")) {
      view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
      return;
    }
    const pop = makePopover(view, btn);
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
function renderSizeControl(view: BoardView, h: HTMLElement, session: DrawSession) {
  const btn = h.createDiv({ cls: "mgn-ctx-tool mgn-ctx-sizebtn", attr: { "aria-label": "Stroke size" } });
  const dot = btn.createDiv({ cls: "mgn-ctx-sizedot" });
  const sizeDot = (el: HTMLElement, s: number) => {
    const d = Math.max(3, Math.min(18, s));
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
  };
  sizeDot(dot, session.size);
  btn.addEventListener("click", () => {
    if (view.contentEl.querySelector(".mgn-ctx-popover")) {
      view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
      return;
    }
    const pop = makePopover(view, btn);
    const list = pop.createDiv({ cls: "mgn-ctx-sizelist" });
    for (const s of STROKE_SIZES) {
      const row = list.createDiv({ cls: "mgn-ctx-sizerow" });
      sizeDot(row.createDiv({ cls: "mgn-ctx-sizedot" }), s);
      row.addEventListener("click", () => {
        session.size = s;
        sizeDot(dot, s);
        view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
      });
    }
  });
}

/** create the world-space SVG surface + viewBox aligned to the current view */
function makeSurface(view: BoardView): SVGSVGElement {
  const surface = view.viewportEl.createSvg("svg", { cls: "mgn-draw-surface" }) as unknown as SVGSVGElement;
  const vr = view.viewportEl.getBoundingClientRect();
  const tl = view.screenToWorld(vr.left, vr.top);
  surface.setAttribute("viewBox", `${tl.x} ${tl.y} ${vr.width / view.zoom} ${vr.height / view.zoom}`);
  return surface;
}

export function enterDrawMode(view: BoardView, editItem?: Item) {
  if (view.drawMode) return;
  view.closePreview();
  view.selection.clear();
  view.refreshSelectionClasses();
  view.viewportEl.addClass("mgn-draw-active"); // fades the board (all cards) uniformly

  const scrim = view.viewportEl.createDiv({ cls: "mgn-draw-scrim" });
  const surface = makeSurface(view);
  const session = new DrawSession({
    svg: surface,
    toCoords: (e) => view.screenToWorld(e.clientX, e.clientY),
  });
  session.color = view.defaultStrokeColor();
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
  const toolbar = makeDrawToolbar(
    view,
    view.viewportEl,
    session,
    () => view.exitDrawMode(true),
    () => view.exitDrawMode(false),
    false
  );
  // keys reach here via document (the SVG surface never holds focus)
  const keyHandler = (e: KeyboardEvent) => {
    const m = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); view.exitDrawMode(false); }
    else if (m && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); session.undo(); }
    else if ((m && e.key.toLowerCase() === "z" && e.shiftKey) || (m && e.key.toLowerCase() === "y")) { e.preventDefault(); e.stopPropagation(); session.redo(); }
  };
  document.addEventListener("keydown", keyHandler, true);

  view.drawMode = { session, toolbar, scrim, surface, editId: editItem?.id ?? null, keyHandler };
  if (editItem) view.render(); // hide the item being edited (shown live on the surface)
}

export function exitDrawMode(view: BoardView, save: boolean) {
  const dm = view.drawMode;
  if (!dm) return;
  document.removeEventListener("keydown", dm.keyHandler, true);
  dm.toolbar.close();
  dm.surface.remove();
  dm.scrim.remove();
  view.viewportEl.removeClass("mgn-draw-active");
  view.drawMode = null;

  if (!save) {
    if (dm.editId) view.render(); // restore the item we hid for editing
    return;
  }
  // remove the item being edited; it is replaced by the regrouped result
  if (dm.editId) view.board.items = view.board.items.filter((i) => i.id !== dm.editId);
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
    view.board.items.push(it);
    newIds.push(it.id);
  }
  view.selection = new Set(newIds);
  view.commit();
}

export function addSketch(view: BoardView, x?: number, y?: number) {
  view.addItem({ type: "sketch", strokes: [], w: 280, h: 200 }, x, y);
}

/** popup editor for a sketch card (draw only inside the fixed canvas) */
export function openSketchPopup(view: BoardView, it: Item) {
  view.closePreview();
  const W = 640, H = 440;
  const ov = view.contentEl.createDiv({ cls: "mgn-preview" });
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
  session.color = view.defaultStrokeColor();
  session.setStrokes(it.strokes ?? []);

  let toolbar: ContextToolbar;
  const finish = (save: boolean) => {
    if (save) {
      it.strokes = structuredClone(session.strokes);
      view.commit(false);
      view.rerenderItem(it);
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
  toolbar = makeDrawToolbar(view, ov, session, () => finish(true), () => finish(false), false);
}
