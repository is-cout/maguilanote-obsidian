import type { BoardView } from "./board-view";
import { ContextToolbar, CtxGroup } from "./draw";
import { makePopover } from "./drawing-toolbar";
import { CARD_COLORS, Item, TITLE_ELIGIBLE_TYPES, colorOf } from "./types";

/** types that don't get a card-color / accent-color control (same as the old context menu) */
const COLOR_EXCLUDED_TYPES = ["swatch", "column"];

/** swatch-grid button; opens a popover of CARD_COLORS and calls `apply` on pick */
function renderCardColorControl(
  view: BoardView,
  h: HTMLElement,
  it: Item,
  label: string,
  get: (it: Item) => string | undefined,
  apply: (it: Item, key: string | undefined) => void
) {
  const btn = h.createDiv({ cls: "mgn-ctx-tool mgn-ctx-swatchbtn", attr: { "aria-label": label } });
  const dot = btn.createDiv({ cls: "mgn-ctx-colordot" });
  dot.style.background = colorOf(get(it)).bg;
  btn.addEventListener("click", () => {
    if (view.contentEl.querySelector(".mgn-ctx-popover")) {
      view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
      return;
    }
    const pop = makePopover(view, btn);
    const grid = pop.createDiv({ cls: "mgn-ctx-colorgrid" });
    for (const c of CARD_COLORS) {
      const sw = grid.createDiv({ cls: "mgn-ctx-swatch", attr: { "aria-label": c.name } });
      sw.style.background = c.bg;
      sw.addEventListener("click", () => {
        for (const id of view.selection) {
          const t = view.item(id);
          if (t && !COLOR_EXCLUDED_TYPES.includes(t.type)) apply(t, c.key === "default" ? undefined : c.key);
        }
        dot.style.background = c.bg;
        view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
        view.commit();
      });
    }
  });
}

/** builds the per-item groups shown in the card contextual toolbar */
function buildGroups(view: BoardView, it: Item): CtxGroup[] {
  const groups: CtxGroup[] = [];

  if (!COLOR_EXCLUDED_TYPES.includes(it.type)) {
    groups.push([
      {
        render: (h) =>
          renderCardColorControl(view, h, it, "Card color", (t) => t.color, (t, key) => {
            t.color = key;
          }),
      },
      {
        render: (h) =>
          renderCardColorControl(view, h, it, "Accent color", (t) => t.accentColor, (t, key) => {
            t.accentColor = key;
          }),
      },
    ]);
  }

  if (TITLE_ELIGIBLE_TYPES.includes(it.type)) {
    groups.push([
      {
        icon: "heading",
        label: it.showTitle ? "Hide title" : "Show title",
        onClick: () => {
          const show = !it.showTitle;
          for (const id of view.selection) {
            const t = view.item(id);
            if (t && TITLE_ELIGIBLE_TYPES.includes(t.type)) t.showTitle = show;
          }
          view.commit();
        },
      },
    ]);
  }

  if (it.type === "file" || it.type === "image" || it.type === "board") {
    groups.push([
      { icon: "link-2", label: "Replace reference...", onClick: () => view.relinkItem(it) },
    ]);
  }
  if (it.type === "record" && it.path) {
    groups.push([
      { icon: "captions", label: "Transcribe text", onClick: () => view.transcribeRecord(it) },
    ]);
  }

  return groups;
}

/** open (or rebuild) the card contextual toolbar for a single selected item */
export function openCardToolbar(view: BoardView) {
  closeCardToolbar(view);
  if (view.drawMode || view.selection.size !== 1) return;
  const it = view.item([...view.selection][0]);
  if (!it) return;
  const groups = buildGroups(view, it);
  if (!groups.length) return;
  view.cardToolbar = new ContextToolbar(view.viewportEl, view.tbEl, groups);
}

export function closeCardToolbar(view: BoardView) {
  view.cardToolbar?.close();
  view.cardToolbar = null;
}

/** keep the card toolbar in sync with the current selection */
export function syncCardToolbar(view: BoardView) {
  if (view.drawMode || view.selection.size !== 1) {
    closeCardToolbar(view);
    return;
  }
  openCardToolbar(view);
}
