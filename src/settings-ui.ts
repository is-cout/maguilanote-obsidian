import { Setting } from "obsidian";
import type MaguilanotePlugin from "./main";
import {
  DEFAULT_KEYBINDINGS,
  KeyBinding,
  SHORTCUT_LABELS,
  ShortcutActionId,
  keyBindingLabel,
} from "./types";

const FONT_CHOICES: [string, string][] = [
  ["", "Default (Obsidian font)"],
  ["var(--font-text)", "Obsidian text font"],
  ["var(--font-monospace)", "Monospace"],
  ["Georgia, 'Times New Roman', serif", "Serif"],
  ["Arial, Helvetica, sans-serif", "Sans-serif"],
];

/** mouse/gesture reference — not key-based, so not rebindable */
const MOUSE_SHORTCUTS: [string, string][] = [
  ["Double-click canvas", "New note"],
  ["Click a card", "Select (then drag to move)"],
  ["Double-click a card", "Edit note / open board / preview file"],
  ["Ctrl+click file/board card", "Open the real file in a new tab"],
  ["Drag a toolbar button", "Create the element where you drop it"],
  ["Alt+drag a card", "Duplicate while dragging"],
  ["Ctrl while dragging", "Invert snap-to-grid"],
  ["Drag the blue dot", "Draw an arrow (drop on empty canvas for a free end)"],
  ["Drag the Line tool", "Add a line, then drag its ends to connect cards"],
  ["Drag a line's middle dot", "Curve it (Free lines only)"],
  ["Double-click an arrow", "Edit its label"],
  ["Right-click an arrow", "Line menu (color, arrowhead, dashed, Free/Smart routing...)"],
  ["Escape", "Cancel selection / close panels"],
  ["Arrow keys (+Shift)", "Nudge selection 1px (10px)"],
  ["Ctrl+scroll", "Zoom"],
  ["Scroll / middle mouse / Space+drag", "Pan"],
  ["Right-click", "Card menu (color, lock, order, replace reference...)"],
];

/**
 * Shared settings UI, rendered identically into the Obsidian plugin settings
 * tab (`MaguilanoteSettingTab`) and the in-board Settings modal (`SettingsModal`)
 * so both surfaces always show the same options.
 */
export function renderSettingsUI(containerEl: HTMLElement, plugin: MaguilanotePlugin) {
  containerEl.empty();
  const s = plugin.settings;
  const save = async () => {
    await plugin.saveSettings();
    plugin.refreshBoards();
  };

  containerEl.createEl("h3", { text: "Board" });

  new Setting(containerEl)
    .setName("Snap to grid")
    .setDesc("Snap cards to an invisible grid while dragging. Hold Ctrl while dragging to temporarily invert this mode.")
    .addToggle((t) =>
      t.setValue(s.gridSnap).onChange(async (v) => {
        s.gridSnap = v;
        await save();
      })
    );

  new Setting(containerEl)
    .setName("Grid size")
    .addSlider((sl) =>
      sl
        .setLimits(8, 64, 4)
        .setValue(s.gridSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          s.gridSize = v;
          await save();
        })
    );

  new Setting(containerEl)
    .setName("Default note width")
    .addSlider((sl) =>
      sl
        .setLimits(160, 480, 20)
        .setValue(s.defaultNoteWidth)
        .setDynamicTooltip()
        .onChange(async (v) => {
          s.defaultNoteWidth = v;
          await save();
        })
    );

  new Setting(containerEl)
    .setName("Templates folder")
    .addText((t) =>
      t.setValue(s.templatesFolder).onChange(async (v) => {
        s.templatesFolder = v || "Maguilanote Templates";
        await save();
      })
    );

  containerEl.createEl("h3", { text: "Customization" });

  new Setting(containerEl)
    .setName("Text size")
    .setDesc("Relative scale applied to all board text (titles scale proportionally). Doesn't affect the breadcrumb bar.")
    .addSlider((sl) =>
      sl
        .setLimits(0.8, 1.4, 0.05)
        .setValue(s.fontScale)
        .setDynamicTooltip()
        .onChange(async (v) => {
          s.fontScale = v;
          await save();
        })
    );

  new Setting(containerEl)
    .setName("Font")
    .addDropdown((d) => {
      for (const [value, label] of FONT_CHOICES) d.addOption(value, label);
      d.setValue(s.fontFamily).onChange(async (v) => {
        s.fontFamily = v;
        await save();
      });
    });

  new Setting(containerEl)
    .setName("Theme")
    .addDropdown((d) =>
      d
        .addOption("dark", "Dark")
        .addOption("light", "Light")
        .setValue(s.theme)
        .onChange(async (v) => {
          s.theme = v as "dark" | "light";
          await save();
        })
    );

  containerEl.createEl("h3", { text: "Shortcuts" });

  for (const id of Object.keys(SHORTCUT_LABELS) as ShortcutActionId[]) {
    const setting = new Setting(containerEl).setName(SHORTCUT_LABELS[id]);
    let btn: HTMLButtonElement;
    const render = () => {
      const b = s.keybindings[id];
      btn.setText(keyBindingLabel(b) || "(none — click to set)");
    };
    setting.addButton((b) => {
      btn = b.buttonEl;
      b.onClick(() => recordBinding(plugin, id, btn, render, save));
    });
    setting.addExtraButton((b) =>
      b
        .setIcon("rotate-ccw")
        .setTooltip("Reset to default")
        .onClick(async () => {
          s.keybindings[id] = DEFAULT_KEYBINDINGS[id];
          await save();
          render();
        })
    );
    render();
  }

  const details = containerEl.createEl("details", { cls: "mgn-shortcuts-foldout" });
  details.createEl("summary", { text: "Mouse & gestures (reference)" });
  const table = details.createEl("table", { cls: "mgn-shortcuts" });
  for (const [k, v] of MOUSE_SHORTCUTS) {
    const tr = table.createEl("tr");
    tr.createEl("td", { text: k, cls: "mgn-shortcut-key" });
    tr.createEl("td", { text: v });
  }
}

function recordBinding(
  plugin: MaguilanotePlugin,
  id: ShortcutActionId,
  btn: HTMLButtonElement,
  render: () => void,
  save: () => Promise<void>
) {
  btn.setText("Press a key…");
  const onKey = async (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      render();
    } else if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      return; // wait for the actual key
    } else {
      const binding: KeyBinding = {
        key: e.key.toLowerCase(),
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
      };
      plugin.settings.keybindings[id] = binding;
      await save();
      render();
    }
    window.removeEventListener("keydown", onKey, true);
  };
  window.addEventListener("keydown", onKey, true);
}
