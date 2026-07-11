import { Notice } from "obsidian";
import type { BoardView } from "./board-view";

export function applyTransform(view: BoardView) {
  view.worldEl.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  view.zoomLabel?.setText(`${Math.round(view.zoom * 100)}%`);
  const gs = view.plugin.settings.gridSize * view.zoom;
  view.viewportEl.style.backgroundSize = `${gs}px ${gs}px`;
  view.viewportEl.style.backgroundPosition = `${view.panX}px ${view.panY}px`;
}

export function screenToWorld(view: BoardView, clientX: number, clientY: number) {
  const r = view.viewportEl.getBoundingClientRect();
  return {
    x: (clientX - r.left - view.panX) / view.zoom,
    y: (clientY - r.top - view.panY) / view.zoom,
  };
}

export function viewCenter(view: BoardView) {
  const r = view.viewportEl.getBoundingClientRect();
  return view.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}

export function setZoom(view: BoardView, z: number, cx?: number, cy?: number) {
  z = Math.min(3, Math.max(0.1, z));
  const r = view.viewportEl.getBoundingClientRect();
  const px = cx ?? r.left + r.width / 2;
  const py = cy ?? r.top + r.height / 2;
  const before = view.screenToWorld(px, py);
  view.zoom = z;
  const afterX = before.x * view.zoom + view.panX + r.left;
  const afterY = before.y * view.zoom + view.panY + r.top;
  view.panX += px - afterX;
  view.panY += py - afterY;
  view.applyTransform();
}

export function zoomToFit(view: BoardView, initial = false) {
  const rects = view.cardWorldRects();
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
  const vr = view.viewportEl.getBoundingClientRect();
  const pad = 60;
  const zw = (vr.width - pad * 2) / (maxX - minX || 1);
  const zh = (vr.height - pad * 2) / (maxY - minY || 1);
  view.zoom = Math.min(1.25, Math.max(0.1, Math.min(zw, zh)));
  view.panX = (vr.width - (maxX - minX) * view.zoom) / 2 - minX * view.zoom;
  view.panY = (vr.height - (maxY - minY) * view.zoom) / 2 - minY * view.zoom;
  view.applyTransform();
}

export function centerOn(view: BoardView, id: string) {
  const rects = view.cardWorldRects();
  const r = rects.get(id);
  if (!r) return;
  const vr = view.viewportEl.getBoundingClientRect();
  view.panX = vr.width / 2 - (r.x + r.w / 2) * view.zoom;
  view.panY = vr.height / 2 - (r.y + r.h / 2) * view.zoom;
  view.applyTransform();
}

/** world-space rects of every rendered card (incl. column children) */
export function cardWorldRects(view: BoardView): Map<string, { x: number; y: number; w: number; h: number }> {
  const map = new Map<string, { x: number; y: number; w: number; h: number }>();
  const wr = view.worldEl.getBoundingClientRect();
  view.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    const r = el.getBoundingClientRect();
    map.set(id, {
      x: (r.left - wr.left) / view.zoom,
      y: (r.top - wr.top) / view.zoom,
      w: r.width / view.zoom,
      h: r.height / view.zoom,
    });
  });
  return map;
}

export function onWheel(view: BoardView, e: WheelEvent) {
  if (view.drawMode) { e.preventDefault(); return; } // lock view while drawing
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.setZoom(view.zoom * factor, e.clientX, e.clientY);
  } else {
    view.panX -= e.deltaX;
    view.panY -= e.deltaY;
    view.applyTransform();
  }
}
