import { Menu } from "obsidian";
import type { BoardView } from "./board-view";
import { TextPromptModal } from "./modals";
import { CARD_COLORS, colorOf } from "./types";

export function onContextMenu(view: BoardView, e: MouseEvent) {
  if (view.drawMode) { e.preventDefault(); return; }
  const target = e.target as HTMLElement;
  const edgeEl = target.closest<HTMLElement>(".mgn-edge-hit, .mgn-edge-label");
  if (edgeEl?.dataset.id) {
    e.preventDefault();
    const edge = view.board.edges.find((x) => x.id === edgeEl.dataset.id);
    if (!edge) return;
    const menu = new Menu();
    menu.addItem((i) => {
      i.setTitle("Line color").setIcon("palette");
      const sub = (i as any).setSubmenu?.() as Menu | undefined;
      if (sub) {
        for (const c of CARD_COLORS) {
          sub.addItem((si) =>
            si.setTitle(c.name).setChecked(colorOf(edge.color).key === c.key).onClick(() => {
              edge.color = c.key === "default" ? undefined : c.key; // default = themed line color
              view.commit();
            })
          );
        }
      } else {
        i.onClick(() => {
          const idx = CARD_COLORS.findIndex((c) => c.key === colorOf(edge.color).key);
          const next = CARD_COLORS[(idx + 1) % CARD_COLORS.length].key;
          edge.color = next === "default" ? undefined : next;
          view.commit();
        });
      }
    });
    menu.addItem((i) => i.setTitle("Edit label").setIcon("pencil").onClick(() => {
      new TextPromptModal(view.app, "Arrow label", edge.label ?? "", (v) => {
        edge.label = v || undefined;
        view.commit();
      }).open();
    }));
    menu.addItem((i) => i.setTitle(edge.arrow === false ? "Show arrowhead" : "Remove arrowhead").setIcon("move-right").onClick(() => {
      edge.arrow = edge.arrow === false ? true : false;
      view.commit();
    }));
    menu.addItem((i) => i.setTitle(edge.dashed ? "Solid line" : "Dashed line").setIcon("minus").onClick(() => {
      edge.dashed = !edge.dashed;
      view.commit();
    }));
    menu.addItem((i) => i.setTitle("Reverse direction").setIcon("arrow-left-right").onClick(() => {
      [edge.from, edge.to] = [edge.to, edge.from];
      [edge.fromPt, edge.toPt] = [edge.toPt, edge.fromPt];
      view.commit();
    }));
    menu.addItem((i) => {
      const isFree = (edge.mode ?? "smart") === "free";
      i.setTitle(isFree ? "Switch to Smart routing" : "Switch to Free line").setIcon("route").onClick(() => {
        edge.mode = isFree ? "smart" : "free";
        if (edge.mode === "smart") edge.bend = undefined; // bend curve only applies to Free
        view.commit();
      });
    });
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Delete arrow").setIcon("trash").onClick(() => {
      view.board.edges = view.board.edges.filter((x) => x.id !== edge.id);
      view.commit();
    }));
    menu.showAtMouseEvent(e);
    return;
  }

  const cardEl = target.closest<HTMLElement>(".mgn-card");
  if (!cardEl?.dataset.id) return;
  e.preventDefault();
  const it = view.item(cardEl.dataset.id);
  if (!it) return;
  if (!view.selection.has(it.id)) {
    view.selection = new Set([it.id]);
    view.refreshSelectionClasses();
  }
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(it.locked ? "Unlock" : "Lock on board").setIcon(it.locked ? "unlock" : "lock").onClick(() => {
    it.locked = !it.locked;
    view.commit();
  }));
  menu.addItem((i) => i.setTitle("Duplicate (Ctrl+D)").setIcon("copy").onClick(() => view.duplicateSelection()));
  menu.addItem((i) => i.setTitle("Bring to front").setIcon("arrow-up").onClick(() => {
    const idx = view.board.items.findIndex((x) => x.id === it.id);
    const [moved] = view.board.items.splice(idx, 1);
    view.board.items.push(moved);
    view.commit();
  }));
  menu.addItem((i) => i.setTitle("Send to back").setIcon("arrow-down").onClick(() => {
    const idx = view.board.items.findIndex((x) => x.id === it.id);
    const [moved] = view.board.items.splice(idx, 1);
    view.board.items.unshift(moved);
    view.commit();
  }));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Delete").setIcon("trash").onClick(() => view.deleteSelection()));
  menu.showAtMouseEvent(e);
}
