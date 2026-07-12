import { MarkdownRenderer, setIcon } from "obsidian";
import type { BoardView } from "./board-view";
import { TextPromptModal } from "./modals";
import { AUDIO_EXTS, IMAGE_EXTS, Item, TITLE_LABELS, TodoEntry, VIDEO_EXTS, colorOf, contrastColor, newId } from "./types";
import { strokeToPath, strokesBBox } from "./draw";

function markMissing(el: HTMLElement, label = "Missing reference") {
  el.addClass("mgn-missing");
  const w = el.createDiv({ cls: "mgn-missing-label" });
  setIcon(w.createSpan(), "alert-triangle");
  w.createSpan({ text: label });
}

/** centered empty-state placeholder: an icon above a "double-click to…" hint */
function iconPlaceholder(parent: HTMLElement, icon: string, text: string) {
  const ph = parent.createDiv({ cls: "mgn-placeholder mgn-icon-placeholder" });
  setIcon(ph.createSpan({ cls: "mgn-icon-placeholder-ico" }), icon);
  ph.createSpan({ cls: "mgn-icon-placeholder-text", text });
}

/** audio elements of record cards, kept alive across re-renders (keyed by item id)
 * so a full board render never reloads the media (which used to flash the card) */
const recordAudio = new Map<string, HTMLAudioElement>();

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** pause a record card's cached audio (used when the record popup closes) */
export function pauseRecordAudio(id: string) {
  recordAudio.get(id)?.pause();
}

/** video card player: the picture stays a plain drag surface (like an image
 * card) and a custom control bar overlays the bottom, so play/seek work by
 * clicking the bar without first selecting the card — native <video controls>
 * can't do this, as its picture and controls are one non-splittable element. */
export function renderVideoPlayer(view: BoardView, el: HTMLElement, src: string) {
  const wrap = el.createDiv({ cls: "mgn-video-wrap" });
  const v = wrap.createEl("video", {
    attr: { src, preload: "metadata", style: "width:100%;display:block;border-radius:2px;" },
  });
  v.addEventListener("loadeddata", () => view.drawEdges());

  const player = wrap.createDiv({ cls: "mgn-video-bar" });
  const btn = player.createEl("button", { cls: "mgn-video-play" });
  const bar = player.createDiv({ cls: "mgn-video-progress" });
  const fill = bar.createDiv({ cls: "mgn-video-progress-fill" });
  const time = player.createDiv({ cls: "mgn-video-time" });

  const sync = () => {
    setIcon(btn, v.paused ? "play" : "pause");
    const t = v.duration || 0;
    fill.style.width = t ? `${Math.min(100, (v.currentTime / t) * 100)}%` : "0%";
    time.setText(`${fmtTime(v.currentTime)} / ${fmtTime(t)}`);
  };
  v.onloadedmetadata = v.ontimeupdate = v.onplay = v.onpause = v.onended = sync;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  });
  bar.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = v.duration || 0;
    if (!t) return;
    const r = bar.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t;
    sync();
  });
  sync();
}

/** compact play/seek/time player for a record card */
export function renderRecordPlayer(el: HTMLElement, it: Item, src: string) {
  let audio = recordAudio.get(it.id);
  if (!audio || audio.src !== src) {
    audio?.pause();
    audio = new Audio(src);
    audio.preload = "metadata";
    recordAudio.set(it.id, audio);
  }
  const player = el.createDiv({ cls: "mgn-record-player" });
  const btn = player.createEl("button", { cls: "mgn-record-play" });
  const bar = player.createDiv({ cls: "mgn-record-bar" });
  const fill = bar.createDiv({ cls: "mgn-record-bar-fill" });
  const time = player.createDiv({ cls: "mgn-record-time" });

  // MediaRecorder webm files carry no duration metadata (audio.duration is
  // Infinity), so fall back to the length measured while recording
  const total = () =>
    Number.isFinite(audio!.duration) && audio!.duration > 0 ? audio!.duration : it.duration ?? 0;
  const sync = () => {
    setIcon(btn, audio!.paused ? "play" : "pause");
    const t = total();
    fill.style.width = t ? `${Math.min(100, (audio!.currentTime / t) * 100)}%` : "0%";
    time.setText(`${fmtTime(audio!.currentTime)} / ${fmtTime(t)}`);
  };
  // assigned (not addEventListener) so re-renders replace the handlers of the reused element
  audio.onloadedmetadata = audio.ontimeupdate = audio.onplay = audio.onpause = audio.onended = sync;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (audio!.paused) audio!.play().catch(() => {});
    else audio!.pause();
  });
  bar.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = total();
    if (!t) return;
    const r = bar.getBoundingClientRect();
    audio!.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t;
    sync();
  });
  sync();
}

/**
 * Grip-drag on a to-do item. Follows the pointer with a floating ghost and shows
 * a live preview of the outcome:
 *   - over the SAME card  → an insertion line previews the reorder,
 *   - over ANOTHER to-do card → that card highlights + an insertion line previews the move,
 *   - over empty canvas   → the ghost switches to a "new card" style.
 * The model is only mutated on drop (`applyTodoDrop`); if the source card is left
 * empty by a move, it's deleted. Listens on `window` so nothing kills the drag.
 */
type TodoDropTarget = { card: Item; index: number } | null;

function startTodoItemDrag(view: BoardView, source: Item, startIdx: number, e: PointerEvent) {
  if (!source.todos || source.todos.length === 0) return;
  e.preventDefault();
  e.stopPropagation(); // don't let the board start a card-move drag
  const entry = source.todos[startIdx];

  const ghost = document.body.createDiv({ cls: "mgn-todo-ghost", text: entry.text || "Empty item" });
  const dropLine = createDiv({ cls: "mgn-todo-drop-line" });
  document.body.addClass("mgn-todo-grabbing"); // force the move cursor board-wide

  let target: TodoDropTarget = null;
  let hlEl: HTMLElement | null = null;

  const positionGhost = (ev: PointerEvent) => {
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 6}px`;
  };
  const clearTarget = () => {
    hlEl?.removeClass("mgn-todo-drop-target");
    hlEl = null;
    dropLine.remove();
  };

  const onMove = (ev: PointerEvent) => {
    positionGhost(ev);
    const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const cardEl = under?.closest<HTMLElement>(".mgn-card.mgn-todo");
    const overItem = cardEl?.dataset.id ? view.item(cardEl.dataset.id) : null;
    if (cardEl && overItem?.type === "todo") {
      if (hlEl !== cardEl) { clearTarget(); hlEl = cardEl; cardEl.addClass("mgn-todo-drop-target"); }
      const listEl = cardEl.querySelector<HTMLElement>(".mgn-todo-list") ?? cardEl;
      const rows = Array.from(cardEl.querySelectorAll<HTMLElement>(".mgn-todo-row"));
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rr = rows[i].getBoundingClientRect();
        if (ev.clientY < rr.top + rr.height / 2) { index = i; break; }
      }
      if (index < rows.length) listEl.insertBefore(dropLine, rows[index]);
      else listEl.appendChild(dropLine);
      ghost.removeClass("mgn-todo-ghost-new");
      target = { card: overItem, index };
    } else {
      clearTarget();
      ghost.addClass("mgn-todo-ghost-new"); // hints "drop here to make a new card"
      target = null;
    }
  };

  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    clearTarget();
    ghost.remove();
    document.body.removeClass("mgn-todo-grabbing");
    applyTodoDrop(view, source, entry, target, ev);
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  onMove(e); // seed the preview immediately (grip pointerdown already located us)
}

/** commit a to-do item drop: reorder in place, move into another card, or spin
 * off a new card — deleting the source card if the move empties it */
function applyTodoDrop(view: BoardView, source: Item, entry: TodoEntry, target: TodoDropTarget, ev: PointerEvent) {
  const srcIdx = source.todos?.indexOf(entry) ?? -1;
  if (srcIdx < 0) return;

  if (target && target.card === source) {
    // reorder within the same card
    source.todos!.splice(srcIdx, 1);
    let idx = target.index;
    if (idx > srcIdx) idx--; // the removed row shifts everything after it up by one
    source.todos!.splice(idx, 0, entry);
    view.commit();
    return;
  }

  // moving the item out of its source card
  source.todos!.splice(srcIdx, 1);
  if (target) {
    (target.card.todos ??= []).splice(target.index, 0, entry);
  } else {
    const w = view.screenToWorld(ev.clientX, ev.clientY);
    const nc: Item = {
      id: newId(),
      type: "todo",
      x: w.x,
      y: w.y,
      w: view.plugin.settings.defaultNoteWidth,
      todos: [entry],
    };
    view.board.items.push(nc);
    view.selection = new Set([nc.id]);
  }
  // a source card left with no items is deleted (card + any edges touching it)
  if (source.todos!.length === 0) {
    view.board.items = view.board.items.filter((i) => i.id !== source.id);
    view.board.edges = view.board.edges.filter((e) => e.from !== source.id && e.to !== source.id);
    view.selection.delete(source.id);
  }
  view.commit();
}

/** optional centered title shown above a card's content when `it.showTitle` is on
 * (toggled via the card's right-click menu) — styled exactly like a column's
 * title. An untouched title defaults to the card's own name, e.g. "Note", as
 * real text the user must delete before typing their own. */
function renderCardTitle(view: BoardView, el: HTMLElement, it: Item) {
  if (!it.showTitle || !(it.type in TITLE_LABELS)) return;
  if (it.title === undefined) it.title = TITLE_LABELS[it.type];
  const head = el.createDiv({ cls: "mgn-card-title" });
  const input = head.createEl("input", {
    cls: "mgn-card-title-text",
    type: "text",
    value: it.title ?? "",
  });
  input.addEventListener("input", () => {
    it.title = input.value;
    view.requestSave();
  });
  input.addEventListener("change", () => view.commit(false));
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
  if (it.accentColor && it.accentColor !== "default" && it.type !== "column" && it.type !== "swatch") {
    el.style.borderLeft = `4px solid ${colorOf(it.accentColor).bg}`;
  }
  if (view.selection.has(it.id)) el.addClass("mgn-selected");
  if (it.locked) el.addClass("mgn-locked");
  renderCardTitle(view, el, it);

  switch (it.type) {
    case "note":
    case "comment": {
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
      if (!it.todos?.length) it.todos = [{ text: "", done: false }]; // always at least one editable row to start typing into
      const list = el.createDiv({ cls: "mgn-todo-list" });
      const focusTodoText = (idx: number, caretEnd = false) => {
        window.setTimeout(() => {
          const fresh = view.worldEl.querySelectorAll<HTMLInputElement>(
            `.mgn-card[data-id="${it.id}"] .mgn-todo-text`
          )[idx];
          if (!fresh) return;
          fresh.focus();
          if (caretEnd) fresh.setSelectionRange(fresh.value.length, fresh.value.length);
        }, 10);
      };
      (it.todos ?? []).forEach((t, idx) => {
        const row = list.createDiv({ cls: "mgn-todo-row" });
        const cb = row.createEl("input", { type: "checkbox", cls: "mgn-todo-check" });
        cb.checked = t.done;
        const txt = row.createEl("input", {
          type: "text",
          cls: "mgn-todo-text" + (t.done ? " mgn-done" : ""),
          value: t.text,
          attr: { placeholder: "Add item" },
        });
        // toggle in place (no rerender) so the checkbox's check-in animation plays
        cb.addEventListener("change", () => {
          t.done = cb.checked;
          txt.toggleClass("mgn-done", cb.checked);
          view.commit(false);
        });
        // keep the model live on every keystroke so a rerender never drops text
        // (persist without a history snapshot); one undo step per edit on blur
        txt.addEventListener("input", () => {
          t.text = txt.value;
          view.requestSave();
        });
        txt.addEventListener("change", () => view.commit(false));
        txt.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (it.todos ??= []).splice(idx + 1, 0, { text: "", done: false });
            view.commit(false);
            view.rerenderItem(it);
            focusTodoText(idx + 1);
          } else if (e.key === "Backspace" && !txt.value && (it.todos?.length ?? 0) > 1) {
            e.preventDefault();
            it.todos?.splice(idx, 1);
            view.commit(false);
            view.rerenderItem(it);
            focusTodoText(Math.max(0, idx - 1), true);
          }
        });
        // grip: drag to reorder within the list, or drag out of the card to
        // split this item off into a new to-do card (replaces the old "x" delete —
        // items are now removed by clearing their text and pressing Backspace)
        const grip = row.createDiv({ cls: "mgn-todo-grip" });
        setIcon(grip, "grip-vertical");
        grip.addEventListener("pointerdown", (e) => startTodoItemDrag(view, it, idx, e));
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
      const isVideo = VIDEO_EXTS.includes(ext);
      // a video card is just its player, like an image card — no default
      // icon+filename head. Other file kinds (audio/pdf/…) keep the head as
      // their identity. Either way the head hides once a custom title is on.
      if (!it.showTitle && !isVideo) {
        const head = el.createDiv({ cls: "mgn-file-head" });
        setIcon(
          head.createSpan({ cls: "mgn-link-ico" }),
          AUDIO_EXTS.includes(ext) ? "music" : "file"
        );
        head.createDiv({ cls: "mgn-link-title", text: f?.name || it.path || "File" });
      }
      if (!f) markMissing(el);
      if (f && AUDIO_EXTS.includes(ext)) {
        el.createEl("audio", {
          attr: { controls: "true", src: view.app.vault.getResourcePath(f), style: "width:100%;margin-top:6px;" },
        });
      }
      if (f && isVideo) {
        renderVideoPlayer(view, el, view.app.vault.getResourcePath(f));
      }
      break;
    }
    case "record": {
      const f = view.resolveFile(it.path);
      if (!it.path) {
        iconPlaceholder(el, "mic", "Double-click to record");
      } else if (!f) {
        markMissing(el);
      } else {
        renderRecordPlayer(el, it, view.app.vault.getResourcePath(f));
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
      const title = head.createEl("input", {
        type: "text",
        cls: "mgn-col-title",
        value: it.title ?? "",
        attr: { placeholder: "Column" },
      });
      title.addEventListener("input", () => {
        it.title = title.value;
        view.requestSave();
      });
      title.addEventListener("change", () => view.commit(false));
      const children = view.board.items
        .filter((ch) => ch.parent === it.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      head.createDiv({
        cls: "mgn-col-count",
        text: `${children.length} ${children.length === 1 ? "card" : "cards"}`,
      });
      const body = el.createDiv({ cls: "mgn-col-body" });
      for (const ch of children) body.appendChild(renderCardFn(view, ch, true));
      if (!children.length) body.createDiv({ cls: "mgn-col-empty" });
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
        iconPlaceholder(prev, "pen-tool", "Double-click to draw");
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

/** point on `rect`'s boundary where the line from its center toward (tx, ty) exits it */
function clipToRect(rect: { x: number; y: number; w: number; h: number }, tx: number, ty: number) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (rect.w === 0 && rect.h === 0) return { x: cx, y: cy };
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tScaleX = dx !== 0 ? rect.w / 2 / Math.abs(dx) : Infinity;
  const tScaleY = dy !== 0 ? rect.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tScaleX, tScaleY);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function drawEdgesFn(view: BoardView) {
  if (!view.svgEl) return;
  view.svgEl.querySelectorAll(".mgn-edge, .mgn-edge-hit, .mgn-edge-handle").forEach((p) => p.remove());
  view.labelsEl.empty();
  const rects = view.cardWorldRects();
  // resolve an endpoint to a rect: an anchored end uses the card rect; a free
  // end (fromPt/toPt) becomes a zero-size rect at that world point so the
  // existing attach-point math works unchanged.
  const endRect = (id: string | undefined, pt: { x: number; y: number } | undefined) => {
    if (id) return rects.get(id) ?? null;
    if (pt) return { x: pt.x, y: pt.y, w: 0, h: 0 };
    return null;
  };
  for (const e of view.board.edges) {
    const a = endRect(e.from, e.fromPt);
    const b = endRect(e.to, e.toPt);
    if (!a || !b) continue;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const selected = view.selectedEdges.has(e.id);
    const mode = e.mode ?? "smart"; // undefined = boards saved before this field existed
    let x1: number, y1: number, x2: number, y2: number;
    let d: string;
    let mx: number, my: number; // label anchor point

    if (mode === "free") {
      // straight line from center to center, clipped at each rect's boundary,
      // optionally bowed through a user-dragged midpoint (`bend`)
      ({ x: x1, y: y1 } = clipToRect(a, bcx, bcy));
      ({ x: x2, y: y2 } = clipToRect(b, acx, acy));
      if (e.bend) {
        d = `M ${x1} ${y1} Q ${e.bend.x} ${e.bend.y}, ${x2} ${y2}`;
        mx = 0.25 * x1 + 0.5 * e.bend.x + 0.25 * x2;
        my = 0.25 * y1 + 0.5 * e.bend.y + 0.25 * y2;
      } else {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
        mx = (x1 + x2) / 2;
        my = (y1 + y2) / 2;
      }
    } else {
      const dx = bcx - acx, dy = bcy - acy;
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
      d = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
      mx = (x1 + x2) / 2 + (c1x + c2x - x1 - x2) * 0.375;
      my = (y1 + y2) / 2 + (c1y + c2y - y1 - y2) * 0.375;
    }

    const hit = view.svgEl.createSvg("path", {
      cls: "mgn-edge-hit",
      attr: { d, fill: "none" },
    });
    hit.dataset.id = e.id;
    // NB: Obsidian's createSvg rejects cls strings containing spaces — use arrays
    const p = view.svgEl.createSvg("path", {
      cls: selected ? ["mgn-edge", "mgn-edge-selected"] : "mgn-edge",
      attr: { d, fill: "none" },
    });
    // "default" (or no color) = the themed line color from CSS, not a card background
    const useColor = e.color && e.color !== "default" && !selected;
    if (e.arrow !== false) {
      const marker = useColor
        ? `mgn-arrowhead-${e.color}`
        : selected ? "mgn-arrowhead-selected" : "mgn-arrowhead";
      p.setAttr("marker-end", `url(#${marker})`);
    }
    if (e.dashed) p.setAttr("stroke-dasharray", "6 5");
    if (useColor) {
      const hex = colorOf(e.color).bg;
      p.style.stroke = hex;
      p.style.color = hex;
    }
    p.dataset.id = e.id;
    if (e.label) {
      const lb = view.labelsEl.createDiv({ cls: "mgn-edge-label", text: e.label });
      lb.style.left = `${mx}px`;
      lb.style.top = `${my}px`;
      lb.dataset.id = e.id;
    }
    if (selected) {
      // draggable endpoint handles
      for (const [end, hx, hy] of [["from", x1, y1], ["to", x2, y2]] as const) {
        const h = view.svgEl.createSvg("circle", {
          cls: "mgn-edge-handle",
          attr: { cx: hx, cy: hy, r: 6 },
        });
        h.dataset.id = e.id;
        h.dataset.end = end;
      }
      // free-mode-only midpoint handle: drag it to curve the line
      if (mode === "free") {
        const bx = e.bend?.x ?? mx, by = e.bend?.y ?? my;
        const h = view.svgEl.createSvg("circle", {
          cls: ["mgn-edge-handle", "mgn-edge-bend-handle"],
          attr: { cx: bx, cy: by, r: 5 },
        });
        h.dataset.id = e.id;
        h.dataset.end = "bend";
      }
    }
  }
}
