import { MarkdownRenderer, setIcon } from "obsidian";
import type { BoardView } from "./board-view";
import { TextPromptModal } from "./modals";
import { AUDIO_EXTS, IMAGE_EXTS, Item, VIDEO_EXTS, colorOf } from "./types";
import { strokeToPath, strokesBBox } from "./draw";

function contrastColor(hex: string): string {
  const m = hex.replace("#", "");
  if (m.length < 6) return "#33343d";
  const r = parseInt(m.slice(0, 2), 16),
    g = parseInt(m.slice(2, 4), 16),
    b = parseInt(m.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#33343d" : "#ffffff";
}

function markMissing(el: HTMLElement, label = "Missing reference") {
  el.addClass("mgn-missing");
  const w = el.createDiv({ cls: "mgn-missing-label" });
  setIcon(w.createSpan(), "alert-triangle");
  w.createSpan({ text: label });
}

export function renderCardFn(view: BoardView, it: Item, inColumn = false): HTMLElement {
  const c = colorOf(it.color);
  const el = createDiv({ cls: `mgn-card mgn-${it.type}` });
  el.dataset.id = it.id;
  if (!inColumn) {
    el.style.left = `${it.x}px`;
    el.style.top = `${it.y}px`;
    el.style.width = `${it.w}px`;
    // manual vertical size acts as a minimum: content can still grow the card
    if (it.h) el.style.minHeight = `${it.h}px`;
  }
  if (it.type !== "column" && it.type !== "swatch" && it.type !== "drawing") {
    el.style.background = c.bg;
    el.style.color = c.fg;
  }
  if (view.selection.has(it.id)) el.addClass("mgn-selected");
  if (it.locked) el.addClass("mgn-locked");

  switch (it.type) {
    case "note":
    case "comment": {
      if (it.type === "comment") {
        const h = el.createDiv({ cls: "mgn-comment-head" });
        setIcon(h.createSpan(), "message-circle");
        h.createSpan({ text: "Comment" });
      }
      const body = el.createDiv({ cls: "mgn-note-body" });
      if (it.text?.trim()) {
        MarkdownRenderer.render(view.app, it.text, body, view.file?.path ?? "", view);
      } else {
        body.createDiv({
          cls: "mgn-placeholder",
          text: it.type === "comment" ? "Empty comment" : "Empty note",
        });
      }
      break;
    }
    case "todo": {
      const title = el.createEl("input", {
        cls: "mgn-todo-title",
        type: "text",
        value: it.title ?? "",
        attr: { placeholder: "To-do" },
      });
      title.addEventListener("change", () => {
        it.title = title.value;
        view.commit(false);
      });
      const done = (it.todos ?? []).filter((t) => t.done).length;
      const total = (it.todos ?? []).length;
      const prog = el.createDiv({ cls: "mgn-todo-progress" });
      prog.createDiv({
        cls: "mgn-todo-progress-fill",
        attr: { style: `width:${total ? (done / total) * 100 : 0}%` },
      });
      const list = el.createDiv({ cls: "mgn-todo-list" });
      (it.todos ?? []).forEach((t, idx) => {
        const row = list.createDiv({ cls: "mgn-todo-row" });
        const cb = row.createEl("input", { type: "checkbox" });
        cb.checked = t.done;
        cb.addEventListener("change", () => {
          t.done = cb.checked;
          view.commit(false);
          view.rerenderItem(it);
        });
        const txt = row.createEl("input", {
          type: "text",
          cls: "mgn-todo-text" + (t.done ? " mgn-done" : ""),
          value: t.text,
        });
        txt.addEventListener("change", () => {
          t.text = txt.value;
          view.commit(false);
        });
        const del = row.createDiv({ cls: "mgn-todo-del" });
        setIcon(del, "x");
        del.addEventListener("click", () => {
          it.todos?.splice(idx, 1);
          view.commit(false);
          view.rerenderItem(it);
        });
      });
      const add = el.createEl("input", {
        type: "text",
        cls: "mgn-todo-add",
        attr: { placeholder: "+ add item" },
      });
      add.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && add.value.trim()) {
          (it.todos ??= []).push({ text: add.value.trim(), done: false });
          view.commit(false);
          view.rerenderItem(it);
          window.setTimeout(() => {
            const fresh = view.worldEl.querySelector<HTMLInputElement>(
              `.mgn-card[data-id="${it.id}"] .mgn-todo-add`
            );
            fresh?.focus();
          }, 10);
        }
      });
      break;
    }
    case "image": {
      const f = view.resolveFile(it.path);
      if (f) {
        const img = el.createEl("img", {
          attr: { src: view.app.vault.getResourcePath(f), draggable: "false" },
        });
        img.addEventListener("load", () => view.drawEdges());
      } else {
        markMissing(el);
      }
      if (it.title) el.createDiv({ cls: "mgn-caption", text: it.title });
      break;
    }
    case "link": {
      const head = el.createDiv({ cls: "mgn-link-head" });
      setIcon(head.createSpan({ cls: "mgn-link-ico" }), "link");
      head.createDiv({ cls: "mgn-link-title", text: it.title || it.url || "Link" });
      el.createDiv({ cls: "mgn-link-url", text: it.url ?? "" });
      const yt = it.url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
      if (yt) {
        const frame = el.createEl("iframe", {
          attr: {
            src: `https://www.youtube.com/embed/${yt[1]}`,
            frameborder: "0",
            allowfullscreen: "true",
            style: "width:100%;aspect-ratio:16/9;border-radius:4px;margin-top:6px;",
          },
        });
        frame.addEventListener("load", () => view.drawEdges());
      }
      break;
    }
    case "file": {
      const f = view.resolveFile(it.path);
      const ext = f?.extension?.toLowerCase() ?? "";
      const head = el.createDiv({ cls: "mgn-file-head" });
      setIcon(
        head.createSpan({ cls: "mgn-link-ico" }),
        AUDIO_EXTS.includes(ext) ? "music" : VIDEO_EXTS.includes(ext) ? "video" : "file"
      );
      head.createDiv({ cls: "mgn-link-title", text: it.title || f?.name || it.path || "File" });
      if (!f) markMissing(el);
      if (f && AUDIO_EXTS.includes(ext)) {
        el.createEl("audio", {
          attr: { controls: "true", src: view.app.vault.getResourcePath(f), style: "width:100%;margin-top:6px;" },
        });
      }
      if (f && VIDEO_EXTS.includes(ext)) {
        const v = el.createEl("video", {
          attr: { controls: "true", src: view.app.vault.getResourcePath(f), style: "width:100%;margin-top:6px;border-radius:4px;" },
        });
        v.addEventListener("loadeddata", () => view.drawEdges());
      }
      break;
    }
    case "board": {
      const inner = el.createDiv({ cls: "mgn-board-inner" });
      setIcon(inner.createDiv({ cls: "mgn-board-ico" }), "layout-dashboard");
      const txt = inner.createDiv({ cls: "mgn-board-text" });
      txt.createDiv({ cls: "mgn-board-title", text: it.title || it.path || "Board" });
      const summary = txt.createDiv({ cls: "mgn-board-summary" });
      const bf = view.resolveFile(it.path);
      if (!bf) {
        markMissing(el);
      } else {
        // Compact content preview: "2 boards, 5 cards, 1 file"
        view.app.vault.cachedRead(bf).then((raw) => {
          try {
            const d = JSON.parse(raw);
            const items: Item[] = Array.isArray(d.items) ? d.items : [];
            const boards = items.filter((i) => i.type === "board").length;
            const files = items.filter((i) => i.type === "file" || i.type === "image").length;
            const cards = items.length - boards - files;
            const parts: string[] = [];
            if (boards) parts.push(`${boards} board${boards > 1 ? "s" : ""}`);
            if (cards) parts.push(`${cards} card${cards > 1 ? "s" : ""}`);
            if (files) parts.push(`${files} file${files > 1 ? "s" : ""}`);
            summary.setText(parts.length ? parts.join(", ") : "Empty board");
            view.drawEdges();
          } catch {
            summary.setText("");
          }
        });
      }
      break;
    }
    case "swatch": {
      const hex = it.swatch ?? "#cccccc";
      el.style.background = hex;
      const lbl = el.createDiv({ cls: "mgn-swatch-label", text: hex.toUpperCase() });
      lbl.style.color = contrastColor(hex);
      const picker = el.createEl("input", {
        type: "color",
        cls: "mgn-swatch-input",
        value: /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#cccccc",
      });
      // live preview WITHOUT re-rendering, so the native picker stays open;
      // persist only when the picker is dismissed (change event)
      picker.addEventListener("input", () => {
        it.swatch = picker.value;
        el.style.background = picker.value;
        lbl.setText(picker.value.toUpperCase());
        lbl.style.color = contrastColor(picker.value);
      });
      picker.addEventListener("change", () => {
        view.commit(false);
      });
      lbl.addEventListener("click", (e) => {
        e.stopPropagation();
        new TextPromptModal(view.app, "Color (hex)", hex, (v) => {
          it.swatch = v.startsWith("#") ? v : "#" + v;
          view.commit();
        }).open();
      });
      break;
    }
    case "column": {
      const head = el.createDiv({ cls: "mgn-col-head" });
      const collapse = head.createDiv({ cls: "mgn-col-collapse" });
      setIcon(collapse, it.collapsed ? "chevron-right" : "chevron-down");
      collapse.addEventListener("click", () => {
        it.collapsed = !it.collapsed;
        view.commit();
      });
      const title = head.createEl("input", {
        type: "text",
        cls: "mgn-col-title",
        value: it.title ?? "",
        attr: { placeholder: "Column" },
      });
      title.addEventListener("change", () => {
        it.title = title.value;
        view.commit(false);
      });
      const children = view.board.items
        .filter((ch) => ch.parent === it.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      head.createDiv({ cls: "mgn-col-count", text: String(children.length) });
      if (!it.collapsed) {
        const body = el.createDiv({ cls: "mgn-col-body" });
        for (const ch of children) body.appendChild(renderCardFn(view, ch, true));
        if (!children.length) body.createDiv({ cls: "mgn-col-empty" });
      }
      break;
    }
    case "drawing": {
      const svg = el.createSvg("svg", {
        cls: "mgn-drawing-svg",
        attr: { viewBox: `0 0 ${it.w} ${it.h ?? it.w}`, preserveAspectRatio: "none" },
      });
      svg.style.width = "100%";
      svg.style.height = `${it.h ?? it.w}px`;
      for (const s of it.strokes ?? []) {
        const p = svg.createSvg("path");
        p.setAttribute("d", strokeToPath(s));
        p.setAttribute("fill", s.color);
      }
      break;
    }
    case "sketch": {
      const head = el.createDiv({ cls: "mgn-sketch-head" });
      setIcon(head.createSpan(), "pen-tool");
      head.createSpan({ text: "Sketch" });
      const prev = el.createDiv({ cls: "mgn-sketch-preview" });
      const strokes = it.strokes ?? [];
      if (strokes.length) {
        const bb = strokesBBox(strokes);
        const svg = prev.createSvg("svg", {
          cls: "mgn-drawing-svg",
          attr: {
            viewBox: `${bb.x} ${bb.y} ${bb.w || 1} ${bb.h || 1}`,
            preserveAspectRatio: "xMidYMid meet",
          },
        });
        for (const s of strokes) {
          const p = svg.createSvg("path");
          p.setAttribute("d", strokeToPath(s));
          p.setAttribute("fill", s.color);
        }
      } else {
        prev.createDiv({ cls: "mgn-placeholder", text: "Double-click to draw" });
      }
      break;
    }
  }

  // adornments (not inside columns: connector + resize)
  if (!inColumn) {
    const conn = el.createDiv({ cls: "mgn-connector", attr: { "aria-label": "Drag to connect" } });
    conn.dataset.for = it.id;
    const rez = el.createDiv({ cls: "mgn-resize" });
    rez.dataset.for = it.id;
  }
  if (it.locked) {
    const lk = el.createDiv({ cls: "mgn-lock-badge" });
    setIcon(lk, "lock");
  }
  return el;
}

export function drawEdgesFn(view: BoardView) {
  if (!view.svgEl) return;
  view.svgEl.querySelectorAll(".mgn-edge, .mgn-edge-hit").forEach((p) => p.remove());
  view.labelsEl.empty();
  const rects = view.cardWorldRects();
  for (const e of view.board.edges) {
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!a || !b) continue;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const dx = bcx - acx, dy = bcy - acy;
    let x1: number, y1: number, x2: number, y2: number;
    let c1x: number, c1y: number, c2x: number, c2y: number;
    const bend = Math.max(40, Math.min(160, Math.hypot(dx, dy) / 2.5));
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) { x1 = a.x + a.w; x2 = b.x; } else { x1 = a.x; x2 = b.x + b.w; }
      y1 = acy; y2 = bcy;
      c1x = x1 + (dx > 0 ? bend : -bend); c1y = y1;
      c2x = x2 - (dx > 0 ? bend : -bend); c2y = y2;
    } else {
      if (dy > 0) { y1 = a.y + a.h; y2 = b.y; } else { y1 = a.y; y2 = b.y + b.h; }
      x1 = acx; x2 = bcx;
      c1x = x1; c1y = y1 + (dy > 0 ? bend : -bend);
      c2x = x2; c2y = y2 - (dy > 0 ? bend : -bend);
    }
    const d = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
    const hit = view.svgEl.createSvg("path", {
      cls: "mgn-edge-hit",
      attr: { d, fill: "none" },
    });
    hit.dataset.id = e.id;
    // NB: Obsidian's createSvg rejects cls strings containing spaces — use arrays
    const p = view.svgEl.createSvg("path", {
      cls: view.selectedEdge === e.id ? ["mgn-edge", "mgn-edge-selected"] : "mgn-edge",
      attr: { d, fill: "none" },
    });
    const useColor = e.color && view.selectedEdge !== e.id;
    if (e.arrow !== false) {
      p.setAttr("marker-end", useColor ? `url(#mgn-arrowhead-${e.color})` : "url(#mgn-arrowhead)");
    }
    if (e.dashed) p.setAttr("stroke-dasharray", "6 5");
    if (useColor) {
      const hex = colorOf(e.color).bg;
      p.style.stroke = hex;
      p.style.color = hex;
    }
    p.dataset.id = e.id;
    if (e.label) {
      const mx = (x1 + x2) / 2 + (c1x + c2x - x1 - x2) * 0.375;
      const my = (y1 + y2) / 2 + (c1y + c2y - y1 - y2) * 0.375;
      const lb = view.labelsEl.createDiv({ cls: "mgn-edge-label", text: e.label });
      lb.style.left = `${mx}px`;
      lb.style.top = `${my}px`;
      lb.dataset.id = e.id;
    }
  }
}
