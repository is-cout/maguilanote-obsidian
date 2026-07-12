import { setIcon } from "obsidian";
import type { BoardView } from "./board-view";
import { ContextToolbar, CtxGroup } from "./draw";
import { makePopover } from "./drawing-toolbar";
import { CARD_COLORS, Item, TITLE_ELIGIBLE_TYPES } from "./types";

/** types that don't get a card-color / accent-color control (same as the old context menu) */
const COLOR_EXCLUDED_TYPES = ["swatch", "column"];

/** icon button; opens a popover with the CARD_COLORS presets + a custom picker
 * (same layout as the Draw/Sketch color control) and applies to the selection */
function renderCardColorControl(
  view: BoardView,
  h: HTMLElement,
  it: Item,
  icon: string,
  label: string,
  get: (it: Item) => string | undefined,
  apply: (it: Item, key: string | undefined) => void
) {
  const btn = h.createDiv({ cls: "mgn-ctx-tool", attr: { "aria-label": label } });
  setIcon(btn, icon);
  btn.addEventListener("click", () => {
    if (view.contentEl.querySelector(".mgn-ctx-popover")) {
      view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
      return;
    }
    const pop = makePopover(view, btn);
    const closePopover = () => view.contentEl.querySelectorAll(".mgn-ctx-popover").forEach((p) => p.remove());
    const applyToSelection = (key: string | undefined, rerenderOnly = false) => {
      for (const id of view.selection) {
        const t = view.item(id);
        if (t && !COLOR_EXCLUDED_TYPES.includes(t.type)) {
          apply(t, key);
          if (rerenderOnly) view.rerenderItem(t);
        }
      }
      if (!rerenderOnly) view.commit();
    };
    const grid = pop.createDiv({ cls: "mgn-ctx-colorgrid" });
    for (const c of CARD_COLORS) {
      const sw = grid.createDiv({ cls: "mgn-ctx-swatch", attr: { "aria-label": c.name } });
      sw.style.background = c.bg;
      sw.addEventListener("click", () => {
        applyToSelection(c.key === "default" ? undefined : c.key);
        closePopover();
      });
    }
    const current = get(it);
    const custom = pop.createEl("input", {
      type: "color",
      cls: "mgn-ctx-customcolor",
      value: current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#000000",
      attr: { "aria-label": "Custom color" },
    });
    // live preview while dragging the picker, committed once it's dismissed
    custom.addEventListener("input", () => applyToSelection(custom.value, true));
    custom.addEventListener("change", () => view.commit(false));
  });
}

/** builds the per-item groups shown in the card contextual toolbar */
function buildGroups(view: BoardView, it: Item): CtxGroup[] {
  const groups: CtxGroup[] = [];

  if (!COLOR_EXCLUDED_TYPES.includes(it.type)) {
    groups.push([
      {
        render: (h) =>
          renderCardColorControl(view, h, it, "palette", "Card color", (t) => t.color, (t, key) => {
            t.color = key;
          }),
      },
      {
        render: (h) =>
          renderCardColorControl(view, h, it, "flag", "Accent color", (t) => t.accentColor, (t, key) => {
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
