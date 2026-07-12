import { TextPromptModal } from "./modals";
import type { BoardView } from "./board-view";
import { Item, newId } from "./types";
import { segmentIntersectsRect } from "./geometry";

export type DragMode =
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
      // physics: last screen pos + time, to derive velocity for a drag tilt
      lastX?: number;
      lastT?: number;
      settleTimer?: number;
    }
  | { kind: "rubber"; startX: number; startY: number; el: HTMLElement }
  | { kind: "resize"; id: string; startWX: number; startWY: number; w0: number; h0: number }
  | { kind: "connect"; from: string; tempPath: SVGPathElement }
  | { kind: "line-end"; id: string; end: "from" | "to" | "bend"; moved: boolean };

/** set the live drag-lean angle (deg) on each dragged card via a CSS var the
 * `.mgn-dragging` transform reads, so the tilt eases through the CSS transition */
function setDragTilt(view: BoardView, ids: string[], deg: number) {
  for (const id of ids) {
    const el = view.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${id}"]`);
    el?.style.setProperty("--mgn-tilt", `${deg}deg`);
  }
}

export function onPointerDown(view: BoardView, e: PointerEvent) {
  if (view.drawMode) return; // draw surface handles its own pointers
  const target = e.target as HTMLElement;
  // never steal focus from active inputs/editors (blur would kill them)
  const interactive = !!target.closest(
    "input, textarea, audio, video, iframe, a, button, .mgn-todo-grip, .mgn-record-player, [contenteditable=true]"
  );
  if (!interactive) view.viewportEl.focus({ preventScroll: true });

  // middle mouse OR space+left => pan
  if (e.button === 1 || (e.button === 0 && view.spaceDown)) {
    view.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY };
    view.viewportEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  if (interactive) return;

  view.lastDownOnCanvas = false;

  const connEl = target.closest<HTMLElement>(".mgn-connector");
  if (connEl?.dataset.for) {
    const tempPath = view.svgEl.createSvg("path", {
      cls: ["mgn-edge", "mgn-edge-temp"],
      attr: { fill: "none" },
    });
    view.drag = { kind: "connect", from: connEl.dataset.for, tempPath };
    view.viewportEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  const rezEl = target.closest<HTMLElement>(".mgn-resize");
  if (rezEl?.dataset.for) {
    const it = view.item(rezEl.dataset.for);
    if (!it || it.locked) return;
    const w = view.screenToWorld(e.clientX, e.clientY);
    const cardDom = view.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${it.id}"]`);
    const h0 = it.h ?? (cardDom ? cardDom.getBoundingClientRect().height / view.zoom : 60);
    view.drag = { kind: "resize", id: it.id, startWX: w.x, startWY: w.y, w0: it.w, h0 };
    view.viewportEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  // dragging a selected line's endpoint handle
  const handleEl = target.closest<SVGElement>(".mgn-edge-handle");
  if (handleEl?.dataset.id && handleEl.dataset.end) {
    view.drag = {
      kind: "line-end",
      id: handleEl.dataset.id,
      end: handleEl.dataset.end as "from" | "to" | "bend",
      moved: false,
    };
    view.viewportEl.setPointerCapture(e.pointerId);
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
    const isDouble = view.lastClickId === id && now - view.lastClickAt < 450;
    view.lastClickAt = now;
    view.lastClickId = id;
    view.selectedEdges = new Set([id]);
    view.selection.clear();
    view.refreshSelectionClasses();
    view.drawEdges();
    if (isDouble) {
      view.lastClickId = null; // avoid triple-click re-trigger
      const edge = view.board.edges.find((x) => x.id === id);
      if (edge)
        new TextPromptModal(view.app, "Arrow label", edge.label ?? "", (v) => {
          edge.label = v || undefined;
          view.commit();
        }).open();
    }
    return;
  }

  const cardEl = target.closest<HTMLElement>(".mgn-card");
  if (cardEl?.dataset.id) {
    const id = cardEl.dataset.id;
    const it = view.item(id);
    if (!it) return;

    // Ctrl+click on a file/image/board card opens the real file in a new tab
    if (
      (e.ctrlKey || e.metaKey) &&
      (it.type === "file" || it.type === "image" || it.type === "board")
    ) {
      const f = view.resolveFile(it.path);
      if (f) view.app.workspace.getLeaf("tab").openFile(f);
      else view.relinkItem(it);
      return;
    }

    view.selectedEdges.clear();
    if (e.shiftKey) {
      if (view.selection.has(id)) view.selection.delete(id);
      else view.selection.add(id);
    } else if (!view.selection.has(id)) {
      view.selection = new Set([id]);
    }
    view.refreshSelectionClasses();

    if (it.locked) return;
    const w = view.screenToWorld(e.clientX, e.clientY);
    // card inside a column: only detach AFTER real movement (click must not detach)
    const detach = !!it.parent;
    let ids = detach
      ? [id]
      : [...view.selection].filter((sid) => !view.item(sid)?.locked && !view.item(sid)?.parent);

    // Alt+drag duplicates the selection and drags the copies
    if (e.altKey && !detach && ids.length) {
      ids = view.cloneInPlace(ids);
      view.selection = new Set(ids);
      view.render();
    }

    const orig = new Map<string, { x: number; y: number }>();
    for (const sid of ids) {
      const si = view.item(sid);
      if (si) orig.set(sid, { x: si.x, y: si.y });
    }
    view.drag = { kind: "move", ids, startWX: w.x, startWY: w.y, orig, moved: false, detach };
    view.viewportEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  // empty canvas: rubber band
  view.lastDownOnCanvas = true;
  view.selection.clear();
  view.selectedEdges.clear();
  view.refreshSelectionClasses();
  view.drawEdges();
  const band = view.viewportEl.createDiv({ cls: "mgn-rubber" });
  const vr = view.viewportEl.getBoundingClientRect();
  view.drag = { kind: "rubber", startX: e.clientX - vr.left, startY: e.clientY - vr.top, el: band };
  view.viewportEl.setPointerCapture(e.pointerId);
}

/** clone items (incl. column children + internal edges) at the same position */
export function cloneInPlace(view: BoardView, rootIds: string[]): string[] {
  const ids = new Set(rootIds);
  for (const it of view.board.items) {
    if (it.parent && ids.has(it.parent)) ids.add(it.id);
  }
  const idMap = new Map<string, string>();
  const clones: Item[] = [];
  for (const it of view.board.items) {
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
  for (const e of view.board.edges) {
    if (e.from === undefined && e.to === undefined) continue; // free line, not tied to items
    if ((e.from && !idMap.has(e.from)) || (e.to && !idMap.has(e.to))) continue;
    view.board.edges.push({
      ...structuredClone(e),
      id: newId(),
      from: e.from ? idMap.get(e.from) : undefined,
      to: e.to ? idMap.get(e.to) : undefined,
    });
  }
  view.board.items.push(...clones);
  return rootIds.map((id) => idMap.get(id)!).filter(Boolean);
}

export function onPointerMove(view: BoardView, e: PointerEvent) {
  // throttle: heavy work (layout reads + edge redraw) at most once per frame
  if (view.drag.kind === "none") return;
  view.lastMoveEvent = e;
  if (view.rafPending) return;
  view.rafPending = true;
  requestAnimationFrame(() => {
    view.rafPending = false;
    if (view.lastMoveEvent && view.drag.kind !== "none") {
      view.processPointerMove(view.lastMoveEvent);
    }
  });
}

/** effective grid snap: setting XOR Ctrl (Ctrl temporarily inverts the mode) */
function snapStep(view: BoardView, e: PointerEvent): number {
  const invert = e.ctrlKey || e.metaKey;
  const on = view.plugin.settings.gridSnap !== invert;
  return on ? view.plugin.settings.gridSize : 0;
}

export function processPointerMove(view: BoardView, e: PointerEvent) {
  const d = view.drag;
  switch (d.kind) {
    case "pan": {
      view.panX = d.panX + (e.clientX - d.startX);
      view.panY = d.panY + (e.clientY - d.startY);
      view.applyTransform();
      break;
    }
    case "move": {
      const w = view.screenToWorld(e.clientX, e.clientY);
      let dx = w.x - d.startWX;
      let dy = w.y - d.startWY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        d.moved = true;
        for (const id of d.ids) {
          view.worldEl.querySelector(`.mgn-card[data-id="${id}"]`)?.classList.add("mgn-dragging");
        }
        if (d.detach) {
          const it = view.item(d.ids[0]);
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
            view.render();
          }
        }
      }
      if (!d.moved) break;
      // velocity-based tilt: the faster you fling a card sideways, the more it
      // leans into the motion — springs back upright when you pause or drop.
      const now = performance.now();
      let tilt = 0;
      if (d.lastX !== undefined && d.lastT !== undefined) {
        const vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT); // px/ms
        tilt = Math.max(-10, Math.min(10, vx * 6));
      }
      d.lastX = e.clientX;
      d.lastT = now;
      window.clearTimeout(d.settleTimer);
      d.settleTimer = window.setTimeout(() => setDragTilt(view, d.ids, 0), 90);
      setDragTilt(view, d.ids, tilt);
      const snap = snapStep(view, e);
      for (const id of d.ids) {
        const it = view.item(id);
        const o = d.orig.get(id);
        if (!it || !o) continue;
        it.x = o.x + dx;
        it.y = o.y + dy;
        if (snap) {
          it.x = Math.round(it.x / snap) * snap;
          it.y = Math.round(it.y / snap) * snap;
        }
        const el = view.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${id}"]`);
        if (el) {
          el.style.left = `${it.x}px`;
          el.style.top = `${it.y}px`;
        }
      }
      view.highlightColumnUnder(e, d.ids);
      if (view.board.edges.length) view.drawEdges();
      break;
    }
    case "rubber": {
      const vr = view.viewportEl.getBoundingClientRect();
      const x = e.clientX - vr.left, y = e.clientY - vr.top;
      const rx = Math.min(x, d.startX), ry = Math.min(y, d.startY);
      const rw = Math.abs(x - d.startX), rh = Math.abs(y - d.startY);
      Object.assign(d.el.style, { left: rx + "px", top: ry + "px", width: rw + "px", height: rh + "px" });
      const wp1 = view.screenToWorld(vr.left + rx, vr.top + ry);
      const wp2 = view.screenToWorld(vr.left + rx + rw, vr.top + ry + rh);
      const rects = view.cardWorldRects();
      view.selection.clear();
      for (const it of view.board.items) {
        if (it.parent) continue;
        const r = rects.get(it.id);
        if (!r) continue;
        if (r.x < wp2.x && r.x + r.w > wp1.x && r.y < wp2.y && r.y + r.h > wp1.y)
          view.selection.add(it.id);
      }
      // a line is selected when any part of it touches the band (same
      // "touches" semantic as cards above, not full enclosure)
      view.selectedEdges.clear();
      const endPoint = (id: string | undefined, pt: { x: number; y: number } | undefined) => {
        if (pt) return pt;
        const r = id ? rects.get(id) : undefined;
        return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
      };
      for (const ed of view.board.edges) {
        const p1 = endPoint(ed.from, ed.fromPt);
        const p2 = endPoint(ed.to, ed.toPt);
        if (p1 && p2 && segmentIntersectsRect(p1.x, p1.y, p2.x, p2.y, wp1.x, wp1.y, wp2.x, wp2.y))
          view.selectedEdges.add(ed.id);
      }
      view.refreshSelectionClasses();
      view.drawEdges();
      break;
    }
    case "resize": {
      const it = view.item(d.id);
      if (!it) break;
      const w = view.screenToWorld(e.clientX, e.clientY);
      const snap = snapStep(view, e);
      it.w = Math.max(120, d.w0 + (w.x - d.startWX));
      it.h = Math.max(48, d.h0 + (w.y - d.startWY));
      if (snap) {
        it.w = Math.max(120, Math.round(it.w / snap) * snap);
        it.h = Math.max(48, Math.round(it.h / snap) * snap);
      }
      const el = view.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${d.id}"]`);
      if (el) {
        el.style.width = `${it.w}px`;
        el.style.minHeight = `${it.h}px`;
      }
      view.drawEdges();
      break;
    }
    case "connect": {
      const rects = view.cardWorldRects();
      const a = rects.get(d.from);
      if (!a) break;
      const w = view.screenToWorld(e.clientX, e.clientY);
      const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2;
      d.tempPath.setAttr("d", `M ${x1} ${y1} L ${w.x} ${w.y}`);
      d.tempPath.setAttr("marker-end", "url(#mgn-arrowhead)");
      break;
    }
    case "line-end": {
      const edge = view.board.edges.find((x) => x.id === d.id);
      if (!edge) break;
      d.moved = true;
      const w = view.screenToWorld(e.clientX, e.clientY);
      if (d.end === "bend") {
        edge.bend = { x: w.x, y: w.y };
      } else {
        // detach from any anchored card and follow the pointer as a free end
        if (d.end === "from") { edge.from = undefined; edge.fromPt = { x: w.x, y: w.y }; }
        else { edge.to = undefined; edge.toPt = { x: w.x, y: w.y }; }
        view.highlightCardUnder(e);
      }
      view.drawEdges();
      break;
    }
  }
}

export function onPointerUp(view: BoardView, e: PointerEvent) {
  // flush the last pointer position (throttled moves may lag one frame)
  if (view.drag.kind !== "none") view.processPointerMove(e);
  const d = view.drag;
  view.drag = { kind: "none" };
  view.lastMoveEvent = null;
  switch (d.kind) {
    case "move": {
      view.clearColumnHighlight();
      window.clearTimeout(d.settleTimer);
      for (const id of d.ids) {
        const el = view.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${id}"]`);
        el?.classList.remove("mgn-dragging");
        el?.style.removeProperty("--mgn-tilt");
      }
      if (!d.moved) {
        // pointer capture retargets native dblclick to the viewport, so we
        // detect card double-clicks manually here
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && d.ids.length === 1) {
          const it = view.item(d.ids[0]);
          if (it) {
            const now = Date.now();
            const isDouble = view.lastClickId === it.id && now - view.lastClickAt < 450;
            view.lastClickAt = now;
            view.lastClickId = it.id;
            if (isDouble) {
              view.lastClickId = null; // avoid triple-click re-trigger
              view.openCard(it);
            }
          }
        }
        break;
      }
      // dropped over a column?
      if (d.ids.length === 1) {
        const col = view.columnUnder(e, d.ids);
        const it = view.item(d.ids[0]);
        if (col && it && it.type !== "column" && col.id !== it.id) {
          const siblings = view.board.items
            .filter((c) => c.parent === col.id)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const rects = view.cardWorldRects();
          const wy = view.screenToWorld(e.clientX, e.clientY).y;
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
      view.commit();
      break;
    }
    case "rubber": {
      d.el.remove();
      break;
    }
    case "resize": {
      view.commit();
      break;
    }
    case "connect": {
      d.tempPath.remove();
      const to = view.cardIdUnder(e);
      if (to && to !== d.from) {
        view.board.edges.push({ id: newId(), from: d.from, to, arrow: true, mode: "free" });
        view.commit();
      } else if (to === d.from) {
        view.drawEdges();
      } else {
        // dropped on empty canvas: create a line with a free end
        const w = view.screenToWorld(e.clientX, e.clientY);
        view.board.edges.push({ id: newId(), from: d.from, toPt: { x: w.x, y: w.y }, arrow: true, mode: "free" });
        view.commit();
      }
      break;
    }
    case "line-end": {
      view.clearCardHighlight();
      if (!d.moved) { view.drawEdges(); break; }
      const edge = view.board.edges.find((x) => x.id === d.id);
      if (edge && d.end !== "bend") {
        const over = view.cardIdUnder(e);
        if (over) {
          // anchor this end to the card under the pointer
          if (d.end === "from") { edge.from = over; edge.fromPt = undefined; }
          else { edge.to = over; edge.toPt = undefined; }
        }
      }
      view.commit();
      break;
    }
  }
}

/** id of the topmost card under the pointer, or null over empty canvas */
export function cardIdUnder(view: BoardView, e: PointerEvent | MouseEvent): string | null {
  const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  return under?.closest<HTMLElement>(".mgn-card")?.dataset.id ?? null;
}

export function highlightCardUnder(view: BoardView, e: PointerEvent) {
  view.clearCardHighlight();
  const id = view.cardIdUnder(e);
  if (id) view.worldEl.querySelector(`.mgn-card[data-id="${id}"]`)?.addClass("mgn-conn-target");
}

export function clearCardHighlight(view: BoardView) {
  view.worldEl.querySelectorAll(".mgn-conn-target").forEach((el) => el.removeClass("mgn-conn-target"));
}

export function columnUnder(view: BoardView, e: PointerEvent, draggedIds: string[]): Item | null {
  const dragged = new Set(draggedIds);
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  for (const el of els) {
    const card = (el as HTMLElement).closest?.(".mgn-card") as HTMLElement | null;
    if (!card?.dataset.id || dragged.has(card.dataset.id)) continue;
    const it = view.item(card.dataset.id);
    if (it?.type === "column") return it;
    if (it?.parent) {
      const parent = view.item(it.parent);
      if (parent?.type === "column") return parent;
    }
  }
  return null;
}

export function highlightColumnUnder(view: BoardView, e: PointerEvent, ids: string[]) {
  view.clearColumnHighlight();
  if (ids.length !== 1) return;
  const it = view.item(ids[0]);
  if (!it || it.type === "column") return;
  const col = view.columnUnder(e, ids);
  if (col) {
    view.worldEl
      .querySelector(`.mgn-card[data-id="${col.id}"]`)
      ?.addClass("mgn-col-target");
  }
}

export function clearColumnHighlight(view: BoardView) {
  view.worldEl.querySelectorAll(".mgn-col-target").forEach((el) => el.removeClass("mgn-col-target"));
}

export function refreshSelectionClasses(view: BoardView) {
  view.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
    el.toggleClass("mgn-selected", view.selection.has(el.dataset.id ?? ""));
  });
}
