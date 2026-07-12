import type { BoardView } from "./board-view";
import { matchesBinding } from "./types";

export function onKeyDown(view: BoardView, e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  const editing =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable;

  if (e.code === "Space" && !editing) {
    view.spaceDown = true;
    return;
  }
  if (editing) return;

  const kb = view.plugin.settings.keybindings;

  if (view.drawMode) {
    if (e.key === "Escape") { e.preventDefault(); view.exitDrawMode(false); return; }
    if (matchesBinding(e, kb.undo)) { e.preventDefault(); view.drawMode.session.undo(); return; }
    if (matchesBinding(e, kb.redo)) { e.preventDefault(); view.drawMode.session.redo(); return; }
    return; // swallow board shortcuts while drawing
  }

  if (matchesBinding(e, kb.undo)) { e.preventDefault(); view.undo(); return; }
  if (matchesBinding(e, kb.redo)) { e.preventDefault(); view.redo(); return; }
  if (matchesBinding(e, kb.duplicate)) { e.preventDefault(); view.duplicateSelection(); return; }
  if (matchesBinding(e, kb.copy)) { e.preventDefault(); view.copySelection(false); return; }
  if (matchesBinding(e, kb.cut)) { e.preventDefault(); view.copySelection(true); return; }
  if (matchesBinding(e, kb.paste)) { view.pasteInternal(); return; }
  if (matchesBinding(e, kb.selectAll)) { e.preventDefault(); view.selection = new Set(view.board.items.filter((i) => !i.parent).map((i) => i.id)); view.refreshSelectionClasses(); return; }
  if (matchesBinding(e, kb.search)) { e.preventDefault(); view.openSearch(); return; }
  if (matchesBinding(e, kb.drawMode)) { view.enterDrawMode(); return; }
  if (matchesBinding(e, kb.zoomReset)) { e.preventDefault(); view.setZoom(1); return; }

  if (matchesBinding(e, kb.deleteSelection) || e.key === "Backspace") {
    e.preventDefault();
    view.deleteSelection();
    return;
  }
  if (e.key === "Escape") {
    view.closePreview();
    view.selection.clear();
    view.selectedEdges.clear();
    view.contentEl.querySelector(".mgn-toolbar .mgn-tool-active")?.removeClass("mgn-tool-active");
    view.refreshSelectionClasses();
    view.drawEdges();
    view.closeSearch();
    return;
  }
  // nudge
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && view.selection.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    for (const id of view.selection) {
      const it = view.item(id);
      if (it && !it.locked && !it.parent) { it.x += dx; it.y += dy; }
    }
    view.commit();
    return;
  }
}
