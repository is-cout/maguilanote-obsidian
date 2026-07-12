import type { BoardView } from "./board-view";
import { Item } from "./types";

export function openSearch(view: BoardView) {
  view.searchEl.show();
  view.searchInput.focus();
  view.searchInput.select();
}

export function closeSearch(view: BoardView) {
  view.searchEl.hide();
  view.searchInput.value = "";
  view.runSearch("");
  view.viewportEl.focus();
}

export function runSearch(view: BoardView, q: string) {
  q = q.toLowerCase().trim();
  view.searchHits = [];
  view.searchIdx = 0;
  view.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
    el.removeClass("mgn-dim", "mgn-hit");
  });
  if (!q) return;
  const matches = (it: Item) =>
    [it.text, it.title, it.url, it.path, it.swatch, ...(it.todos ?? []).map((t) => t.text)]
      .filter(Boolean)
      .some((s) => s!.toLowerCase().includes(q));
  for (const it of view.board.items) {
    if (matches(it)) view.searchHits.push(it.id);
  }
  const hitSet = new Set(view.searchHits);
  view.worldEl.querySelectorAll<HTMLElement>(".mgn-card").forEach((el) => {
    const id = el.dataset.id ?? "";
    el.toggleClass("mgn-hit", hitSet.has(id));
    el.toggleClass("mgn-dim", !hitSet.has(id));
  });
  if (view.searchHits.length) view.centerOn(view.searchHits[0]);
}
