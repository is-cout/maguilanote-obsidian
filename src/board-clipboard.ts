import { Notice } from "obsidian";
import type { BoardView } from "./board-view";
import { Item, newId } from "./types";

export function copySelection(view: BoardView, cut: boolean) {
  if (!view.selection.size) return;
  const ids = new Set(view.selection);
  for (const it of view.board.items) {
    if (it.parent && ids.has(it.parent)) ids.add(it.id);
  }
  const items = view.board.items.filter((i) => ids.has(i.id)).map((i) => structuredClone(i));
  const edges = view.board.edges
    .filter((e) => !!e.from && !!e.to && ids.has(e.from) && ids.has(e.to))
    .map((e) => structuredClone(e));
  view.plugin.clipboard = { items, edges };
  if (cut) {
    view.board.items = view.board.items.filter((i) => !ids.has(i.id));
    view.board.edges = view.board.edges.filter((e) => !(e.from && ids.has(e.from)) && !(e.to && ids.has(e.to)));
    view.selection.clear();
    view.commit();
  }
  new Notice(cut ? "Cut" : "Copied");
}

export function pasteInternal(view: BoardView) {
  const clip = view.plugin.clipboard;
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
    if (nf && nt) view.board.edges.push({ ...structuredClone(e), id: newId(), from: nf, to: nt });
  }
  view.board.items.push(...clones);
  view.selection = new Set(clones.filter((c) => !c.parent).map((c) => c.id));
  view.commit();
}

export function duplicateSelection(view: BoardView) {
  if (!view.selection.size) return;
  const saved = view.plugin.clipboard;
  view.copySelection(false);
  view.pasteInternal();
  view.plugin.clipboard = saved;
}

export function deleteSelection(view: BoardView) {
  if (!view.selection.size) return;
  const ids = new Set(view.selection);
  for (const it of view.board.items) {
    if (it.parent && ids.has(it.parent)) ids.add(it.id);
  }
  view.board.items = view.board.items.filter((i) => !ids.has(i.id));
  view.board.edges = view.board.edges.filter((e) => !(e.from && ids.has(e.from)) && !(e.to && ids.has(e.to)));
  view.selection.clear();
  view.commit();
}
