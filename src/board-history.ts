import type { BoardView } from "./board-view";

/** push history snapshot, save + rerender */
export function commit(view: BoardView, rerender = true) {
  view.history = view.history.slice(0, view.histIdx + 1);
  view.history.push(JSON.stringify(view.board));
  if (view.history.length > 100) view.history.shift();
  view.histIdx = view.history.length - 1;
  view.requestSave();
  if (rerender) view.render();
}

export function undo(view: BoardView) {
  if (view.histIdx <= 0) return;
  view.histIdx--;
  view.board = JSON.parse(view.history[view.histIdx]);
  view.selection.clear();
  view.requestSave();
  view.render();
}

export function redo(view: BoardView) {
  if (view.histIdx >= view.history.length - 1) return;
  view.histIdx++;
  view.board = JSON.parse(view.history[view.histIdx]);
  view.selection.clear();
  view.requestSave();
  view.render();
}
