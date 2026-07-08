import { setIcon } from "obsidian";
import { getStroke } from "perfect-freehand";
import { Stroke, DEFAULT_STROKE_COLOR, DEFAULT_STROKE_SIZE } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

// perfect-freehand's `size` is the width at mid pressure (max ≈ size*(1+thinning)).
// We treat the chosen stroke size as the MAX (full-pressure) width, so we feed
// size/(1+THINNING); light pressure then thins down and the min scales with it.
const THINNING = 0.75;

// --------------------------------------------------------------- stroke -> svg
/** Build an SVG path `d` for a stroke, optionally offset by (dx, dy). */
export function strokeToPath(stroke: Stroke, dx = 0, dy = 0): string {
  const input = stroke.points.map((p) => [p[0] + dx, p[1] + dy, p[2] ?? 1]);
  const outline = getStroke(input, {
    size: stroke.size / (1 + THINNING),
    thinning: THINNING,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
  });
  if (!outline.length) return "";
  let d = `M ${outline[0][0]} ${outline[0][1]}`;
  for (let i = 1; i < outline.length; i++) d += ` L ${outline[i][0]} ${outline[i][1]}`;
  return d + " Z";
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

export function strokeBBox(s: Stroke): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  if (!s.points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Bounding box over many strokes, padded by their stroke width. */
export function strokesBBox(strokes: Stroke[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, pad = 0;
  for (const s of strokes) {
    const b = strokeBBox(s);
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    pad = Math.max(pad, s.size);
  }
  if (!strokes.length) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * Cluster strokes whose (padded) bounding boxes are within `distance` of each
 * other. Each returned group carries its strokes rebased to the group box
 * origin, plus the box itself (already padded), ready to become a board item.
 */
export function groupStrokes(
  strokes: Stroke[],
  distance: number
): { strokes: Stroke[]; box: { x: number; y: number; w: number; h: number } }[] {
  if (!strokes.length) return [];
  const boxes = strokes.map(strokeBBox);
  const parent = strokes.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const near = (a: number, b: number): boolean => {
    const A = boxes[a], B = boxes[b];
    const gapX = Math.max(0, A.minX - B.maxX, B.minX - A.maxX);
    const gapY = Math.max(0, A.minY - B.maxY, B.minY - A.maxY);
    return gapX <= distance && gapY <= distance;
  };
  for (let i = 0; i < strokes.length; i++)
    for (let j = i + 1; j < strokes.length; j++)
      if (near(i, j)) parent[find(i)] = find(j);

  const groups = new Map<number, number[]>();
  strokes.forEach((_, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  });

  const out: { strokes: Stroke[]; box: { x: number; y: number; w: number; h: number } }[] = [];
  for (const idxs of groups.values()) {
    const members = idxs.map((i) => strokes[i]);
    const box = strokesBBox(members);
    const rebased = members.map((s) => ({
      color: s.color,
      size: s.size,
      points: s.points.map((p) => [p[0] - box.x, p[1] - box.y, p[2] ?? 0.5]),
    }));
    out.push({ strokes: rebased, box });
  }
  return out;
}

// ----------------------------------------------------------- context toolbar
export interface CtxItem {
  id?: string;
  icon?: string;
  label?: string;
  onClick?: () => void;
  /** custom control (e.g. color / size picker) rendered into its own slot */
  render?: (host: HTMLElement) => void;
}
export type CtxGroup = CtxItem[];

/**
 * Reusable contextual toolbar: dims the main toolbar and shows a floating
 * popup just right of it. Generic on purpose — future modes can reuse it.
 */
export class ContextToolbar {
  el: HTMLElement;
  private mainTb: HTMLElement;
  private btns = new Map<string, HTMLElement>();

  private inline: boolean;

  constructor(host: HTMLElement, mainTb: HTMLElement, groups: CtxGroup[], inline = false) {
    this.mainTb = mainTb;
    this.inline = inline;
    if (!inline) mainTb.addClass("mgn-toolbar-dimmed");
    this.el = host.createDiv({ cls: inline ? "mgn-context-toolbar mgn-context-inline" : "mgn-context-toolbar" });
    groups.forEach((g, gi) => {
      if (gi > 0) this.el.createDiv({ cls: "mgn-ctx-sep" });
      for (const it of g) {
        if (it.render) {
          const wrap = this.el.createDiv({ cls: "mgn-ctx-custom" });
          it.render(wrap);
          continue;
        }
        const b = this.el.createDiv({ cls: "mgn-ctx-tool", attr: { "aria-label": it.label ?? "" } });
        if (it.icon) setIcon(b, it.icon);
        if (it.onClick) b.addEventListener("click", it.onClick);
        if (it.id) this.btns.set(it.id, b);
      }
    });
  }

  setActive(id: string, on: boolean) {
    this.btns.get(id)?.toggleClass("mgn-ctx-active", on);
  }

  close() {
    if (!this.inline) this.mainTb.removeClass("mgn-toolbar-dimmed");
    this.el.remove();
  }
}

// ------------------------------------------------------------- draw session
export type DrawTool = "pen" | "select" | "eraser";

export interface DrawSessionConfig {
  svg: SVGSVGElement;
  /** convert a pointer event to drawing-space coords */
  toCoords: (e: PointerEvent) => { x: number; y: number };
  /** called after any change (enable save state, etc.) */
  onChange?: () => void;
}

export class DrawSession {
  strokes: Stroke[] = [];
  tool: DrawTool = "pen";
  color = DEFAULT_STROKE_COLOR;
  size = DEFAULT_STROKE_SIZE;
  selection = new Set<number>();

  private svg: SVGSVGElement;
  private toCoords: (e: PointerEvent) => { x: number; y: number };
  private onChange?: () => void;
  private strokeG: SVGGElement;
  private overlayG: SVGGElement;

  private undoStack: string[] = [];
  private redoStack: string[] = [];

  private live: number[][] | null = null;
  private drag:
    | { kind: "move"; sx: number; sy: number; orig: number[][][] }
    | { kind: "rubber"; sx: number; sy: number; rect: SVGRectElement }
    | null = null;

  constructor(cfg: DrawSessionConfig) {
    this.svg = cfg.svg;
    this.toCoords = cfg.toCoords;
    this.onChange = cfg.onChange;
    this.strokeG = this.svg.createSvg("g") as unknown as SVGGElement;
    this.overlayG = this.svg.createSvg("g") as unknown as SVGGElement;
    this.svg.addEventListener("pointerdown", (e) => this.onDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onUp(e));
    this.render();
  }

  setStrokes(strokes: Stroke[]) {
    this.strokes = structuredClone(strokes);
    this.selection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  private snapshot() {
    this.undoStack.push(JSON.stringify(this.strokes));
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.strokes));
    this.strokes = JSON.parse(this.undoStack.pop()!);
    this.selection.clear();
    this.render();
    this.onChange?.();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.strokes));
    this.strokes = JSON.parse(this.redoStack.pop()!);
    this.selection.clear();
    this.render();
    this.onChange?.();
  }

  /** recolor the currently selected strokes; no-op if nothing is selected */
  recolorSelection(color: string): boolean {
    if (!this.selection.size) return false;
    this.snapshot();
    for (const i of this.selection) this.strokes[i].color = color;
    this.render();
    this.onChange?.();
    return true;
  }

  // ---------------------------------------------------------------- pointers
  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    const { x, y } = this.toCoords(e);
    // pen/touch use real pressure; mouse has none -> draw at the chosen (max) size
    const pressure = e.pointerType === "pen" || e.pointerType === "touch" ? e.pressure || 0.5 : 1;

    if (this.tool === "pen") {
      this.snapshot();
      this.live = [[x, y, pressure]];
      return;
    }
    if (this.tool === "eraser") {
      this.snapshot();
      this.eraseAt(x, y);
      this.drag = { kind: "move", sx: x, sy: y, orig: [] }; // reuse flag: erasing in progress
      return;
    }
    // select
    const hit = this.hitTest(x, y);
    if (hit >= 0) {
      if (!e.shiftKey && !this.selection.has(hit)) this.selection.clear();
      this.selection.add(hit);
      this.snapshot();
      const orig = [...this.selection].map((i) => this.strokes[i].points.map((p) => [...p]));
      this.drag = { kind: "move", sx: x, sy: y, orig };
      this.render();
    } else {
      if (!e.shiftKey) this.selection.clear();
      const rect = this.overlayG.createSvg("rect", { cls: "mgn-draw-selrect" }) as unknown as SVGRectElement;
      this.drag = { kind: "rubber", sx: x, sy: y, rect };
      this.render();
    }
  }

  private onMove(e: PointerEvent) {
    const { x, y } = this.toCoords(e);

    if (this.live) {
      // pen/touch use real pressure; mouse has none -> draw at the chosen (max) size
    const pressure = e.pointerType === "pen" || e.pointerType === "touch" ? e.pressure || 0.5 : 1;
      this.live.push([x, y, pressure]);
      this.renderLive();
      return;
    }
    if (this.tool === "eraser" && this.drag) {
      this.eraseAt(x, y);
      return;
    }
    if (!this.drag) return;

    if (this.drag.kind === "move") {
      const dx = x - this.drag.sx, dy = y - this.drag.sy;
      const sel = [...this.selection];
      sel.forEach((idx, k) => {
        const orig = this.drag!.kind === "move" ? this.drag!.orig[k] : null;
        if (!orig) return;
        this.strokes[idx].points = orig.map((p) => [p[0] + dx, p[1] + dy, p[2] ?? 0.5]);
      });
      this.render();
    } else if (this.drag.kind === "rubber") {
      const rx = Math.min(x, this.drag.sx), ry = Math.min(y, this.drag.sy);
      const rw = Math.abs(x - this.drag.sx), rh = Math.abs(y - this.drag.sy);
      this.drag.rect.setAttribute("x", String(rx));
      this.drag.rect.setAttribute("y", String(ry));
      this.drag.rect.setAttribute("width", String(rw));
      this.drag.rect.setAttribute("height", String(rh));
      this.selection.clear();
      this.strokes.forEach((s, i) => {
        const b = strokeBBox(s);
        if (b.maxX >= rx && b.minX <= rx + rw && b.maxY >= ry && b.minY <= ry + rh)
          this.selection.add(i);
      });
      this.render(false);
    }
  }

  private onUp(e: PointerEvent) {
    try { this.svg.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.live) {
      if (this.live.length >= 1) {
        this.strokes.push({ points: this.live, color: this.color, size: this.size });
      }
      this.live = null;
      this.render();
      this.onChange?.();
      return;
    }
    if (this.drag) {
      const wasRubber = this.drag.kind === "rubber";
      if (this.drag.kind === "rubber") this.drag.rect.remove();
      this.drag = null;
      if (!wasRubber) this.onChange?.();
      this.render();
    }
  }

  // ------------------------------------------------------------------ helpers
  private eraseAt(x: number, y: number) {
    let changed = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.pointNearStroke(x, y, this.strokes[i])) {
        this.strokes.splice(i, 1);
        changed = true;
      }
    }
    if (changed) {
      this.selection.clear();
      this.render();
      this.onChange?.();
    }
  }

  private hitTest(x: number, y: number): number {
    for (let i = this.strokes.length - 1; i >= 0; i--)
      if (this.pointNearStroke(x, y, this.strokes[i])) return i;
    return -1;
  }

  private pointNearStroke(x: number, y: number, s: Stroke): boolean {
    const thr = s.size / 2 + 6;
    for (const p of s.points) {
      if (Math.hypot(p[0] - x, p[1] - y) <= thr) return true;
    }
    return false;
  }

  private renderLive() {
    let path = this.strokeG.querySelector<SVGPathElement>(".mgn-draw-live");
    if (!path) {
      path = this.strokeG.createSvg("path", { cls: "mgn-draw-live" }) as unknown as SVGPathElement;
    }
    path.setAttribute("d", strokeToPath({ points: this.live!, color: this.color, size: this.size }));
    path.setAttribute("fill", this.color);
  }

  render(withOverlay = true) {
    this.strokeG.empty();
    this.strokes.forEach((s, i) => {
      const p = this.strokeG.createSvg("path", {
        cls: this.selection.has(i) ? ["mgn-draw-stroke", "mgn-draw-selected"] : "mgn-draw-stroke",
      });
      p.setAttribute("d", strokeToPath(s));
      p.setAttribute("fill", s.color);
    });
    if (withOverlay) {
      // keep any live rubber rect; redraw selection boxes
      this.overlayG.querySelectorAll(".mgn-draw-selbox").forEach((n) => n.remove());
      for (const i of this.selection) {
        const b = strokeBBox(this.strokes[i]);
        const r = this.overlayG.createSvg("rect", { cls: "mgn-draw-selbox" });
        r.setAttribute("x", String(b.minX - 4));
        r.setAttribute("y", String(b.minY - 4));
        r.setAttribute("width", String(b.maxX - b.minX + 8));
        r.setAttribute("height", String(b.maxY - b.minY + 8));
      }
    }
  }
}
