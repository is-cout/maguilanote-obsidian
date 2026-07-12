import { Platform, Setting } from "obsidian";
import type MaguilanotePlugin from "./main";
import { loadOpenAiApiKey, saveOpenAiApiKey } from "./secrets";
import {
  CARD_COLOR_NAMES,
  CUSTOM_CARD_COLOR_KEYS,
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

  new Setting(containerEl)
    .setName("Assets folder")
    .setDesc("Where dropped files, images and recordings are saved.")
    .addText((t) =>
      t.setValue(s.assetsFolder).onChange(async (v) => {
        s.assetsFolder = v || "Maguilanote Assets";
        await save();
      })
    );

  containerEl.createEl("h3", { text: "Recording" });

  new Setting(containerEl)
    .setName("Default microphone")
    .setDesc("Used to pre-select the mic when opening a Record card's recording popup.")
    .addDropdown((d) => {
      d.selectEl.addClass("mgn-mic-dropdown");
      d.addOption("", "System default");
      d.setValue(s.defaultMicId);
      navigator.mediaDevices?.enumerateDevices().then((devices) => {
        for (const dev of devices.filter((x) => x.kind === "audioinput")) {
          d.addOption(dev.deviceId, dev.label || "Microphone");
        }
        d.setValue(s.defaultMicId);
      });
      d.onChange(async (v) => {
        s.defaultMicId = v;
        await save();
      });
    });

  new Setting(containerEl)
    .setName("OpenAI API key")
    .setDesc(
      Platform.isDesktopApp
        ? "Used only by \"Transcribe text\" on Record cards (calls the Whisper API). Stored outside this vault, in your OS user profile, so it's never swept up by a vault backup."
        : "Used only by \"Transcribe text\" on Record cards (calls the Whisper API). Mobile has no storage outside the vault, so this is saved in the vault's plugin data — it WILL be included in a vault backup."
    )
    .addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("sk-...").setValue(Platform.isDesktopApp ? loadOpenAiApiKey() : s.openaiApiKey);
      t.onChange(async (v) => {
        const key = v.trim();
        if (Platform.isDesktopApp) {
          saveOpenAiApiKey(key);
        } else {
          s.openaiApiKey = key;
          await save();
        }
      });
    });

  containerEl.createEl("h3", { text: "Customization" });

  new Setting(containerEl)
    .setName("Body font")
    .setDesc("Pick a preset, or type any Google Font family name (e.g. \"Inter\") in the text field.")
    .addDropdown((d) => {
      for (const [value, label] of FONT_CHOICES) d.addOption(value, label);
      d.selectEl.value = FONT_CHOICES.some(([v]) => v === s.fontFamily) ? s.fontFamily : "";
      d.onChange(async (v) => {
        s.fontFamily = v;
        await save();
        renderSettingsUI(containerEl, plugin);
      });
    })
    .addText((t) =>
      t.setPlaceholder("or a Google Font name").setValue(s.fontFamily).onChange(async (v) => {
        s.fontFamily = v.trim();
        await save();
      })
    );

  new Setting(containerEl)
    .setName("Heading font")
    .setDesc("Used for card titles and column titles. Blank = same as body font.")
    .addText((t) =>
      t.setPlaceholder("Google Font name").setValue(s.headingFontFamily).onChange(async (v) => {
        s.headingFontFamily = v.trim();
        await save();
      })
    );

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
          renderSettingsUI(containerEl, plugin); // switch the color section below to the new theme
        })
    );

  // colors are stored separately per theme; only the currently active theme's
  // set is editable here — switching Theme above swaps which set is shown
  containerEl.createEl("h4", { text: `${s.theme === "light" ? "Light" : "Dark"} theme colors` });
  const colors = s.colors[s.theme];

  const colorSetting = (name: string, field: keyof typeof colors) =>
    new Setting(containerEl).setName(name).addColorPicker((cp) =>
      cp.setValue(colors[field]).onChange(async (v) => {
        colors[field] = v;
        await save();
      })
    );

  colorSetting("Board background", "canvasBg");
  colorSetting("Default card background", "cardDefaultBg");
  for (const key of CUSTOM_CARD_COLOR_KEYS) {
    colorSetting(CARD_COLOR_NAMES[key], key);
  }

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
