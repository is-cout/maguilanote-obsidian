import { TFile, normalizePath, requestUrl } from "obsidian";
import type { BoardView } from "./board-view";
import { TextPromptModal, VaultFilePicker } from "./modals";
import { Edge, IMAGE_EXTS, Item, newId, VIDEO_EXTS } from "./types";

function placed(view: BoardView, x?: number, y?: number) {
  const c = view.viewCenter();
  return { x: x ?? c.x - 120, y: y ?? c.y - 60 };
}

export function addItem(view: BoardView, partial: Partial<Item> & { type: Item["type"] }, x?: number, y?: number): Item {
  const p = placed(view, x, y);
  const it: Item = {
    id: newId(),
    x: p.x,
    y: p.y,
    w: view.plugin.settings.defaultNoteWidth,
    ...partial,
  } as Item;
  view.board.items.push(it);
  view.selection = new Set([it.id]);
  view.commit();
  // a new card comes out selected, so it must get its contextual toolbar right
  // away — commit() only re-renders the cards, it doesn't touch the toolbar
  view.syncCardToolbar();
  return it;
}

export function addNote(view: BoardView, x?: number, y?: number, edit = false) {
  const it = view.addItem({ type: "note", text: "" }, x, y);
  if (edit)
    window.setTimeout(() => {
      const el = view.worldEl.querySelector<HTMLElement>(`.mgn-card[data-id="${it.id}"]`);
      if (el) view.editNote(it, el);
    }, 30);
}

export function addTodo(view: BoardView, x?: number, y?: number) {
  // no pre-filled title: titles are opt-in now, and an empty title keeps the
  // placeholder styling consistent with every other card type
  view.addItem({ type: "todo", todos: [] }, x, y);
}

export function addColumn(view: BoardView, x?: number, y?: number) {
  view.addItem({ type: "column", title: "Column", w: 300 }, x, y);
}

export function addSwatch(view: BoardView, x?: number, y?: number) {
  view.addItem({ type: "swatch", swatch: "#31303b", w: 160 }, x, y);
}

export function addComment(view: BoardView, x?: number, y?: number) {
  view.addItem({ type: "comment", text: "", color: "yellow" }, x, y);
}

export function addRecord(view: BoardView, x?: number, y?: number) {
  // no fixed height: the empty-state placeholder sizes the card, and once recorded
  // it shrinks to the compact player (a fixed h would act as a min-height floor)
  view.addItem({ type: "record", w: 220 }, x, y);
}

export function createFromTool(view: BoardView, key: string, x: number, y: number) {
  switch (key) {
    case "note": view.addNote(x, y, true); break;
    case "todo": view.addTodo(x, y); break;
    case "column": view.addColumn(x, y); break;
    case "swatch": view.addSwatch(x, y); break;
    case "comment": view.addComment(x, y); break;
    case "sketch": view.addSketch(x, y); break;
    case "record": view.addRecord(x, y); break;
    case "line": view.addLine(x, y); break;
    case "link": view.promptLink({ x, y }); break;
    case "board": view.promptBoard({ x, y }); break;
    case "image":
      view.pendingPos = { x, y };
      view.imgInput.click();
      break;
    case "file":
      view.pendingPos = { x, y };
      new VaultFilePicker(view.app, (f) => view.addVaultFile(f)).open();
      break;
  }
}

/** drop a standalone line centered on (x, y); both ends free, selected */
export function addLine(view: BoardView, x: number, y: number) {
  const half = 80;
  const edge: Edge = {
    id: newId(),
    fromPt: { x: x - half, y },
    toPt: { x: x + half, y },
    arrow: true,
    mode: "free",
  };
  view.board.edges.push(edge);
  view.selection.clear();
  view.selectedEdges = new Set([edge.id]);
  view.refreshSelectionClasses();
  view.commit();
}

export function promptLink(view: BoardView, pos?: { x: number; y: number }) {
  new TextPromptModal(view.app, "Link URL", "https://", async (url) => {
    if (!url || url === "https://") return;
    const it = view.addItem({ type: "link", url, title: url.replace(/^https?:\/\//, "") }, pos?.x, pos?.y);
    try {
      const res = await requestUrl({ url });
      const m = res.text.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m?.[1]) {
        it.title = m[1].trim();
        view.commit();
      }
    } catch { /* offline or blocked — keep url as title */ }
  }).open();
}

export function promptBoard(view: BoardView, pos?: { x: number; y: number }) {
  new TextPromptModal(view.app, "New board name", "New board", async (name) => {
    if (!name) return;
    const folder = view.file?.parent?.path ?? "";
    const prefix = folder && folder !== "/" ? folder + "/" : "";
    let path = normalizePath(`${prefix}${name}.board`);
    let i = 1;
    while (view.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${prefix}${name} ${i++}.board`);
    }
    await view.app.vault.create(path, JSON.stringify({ version: 1, items: [], edges: [] }, null, 2));
    view.addItem({ type: "board", path, title: name, w: 220 }, pos?.x, pos?.y);
  }).open();
}

export function addVaultFile(view: BoardView, f: TFile) {
  const c = view.pendingPos ?? view.viewCenter();
  view.pendingPos = null;
  view.addVaultFileAt(f, c.x, c.y);
}

export function addVaultFileAt(view: BoardView, f: TFile, x: number, y: number) {
  if (IMAGE_EXTS.includes(f.extension.toLowerCase())) {
    view.addItem({ type: "image", path: f.path, w: 280 }, x - 140, y - 100);
  } else if (f.extension === "board") {
    view.addItem({ type: "board", path: f.path, title: f.basename, w: 220 }, x, y);
  } else {
    const video = VIDEO_EXTS.includes(f.extension.toLowerCase());
    view.addItem({ type: "file", path: f.path, w: video ? 420 : 260 }, x, y);
  }
}
