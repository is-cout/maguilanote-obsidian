import {
  App,
  FuzzySuggestModal,
  Notice,
  Plugin,
  PluginSettingTab,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./board-view";
import { renderSettingsUI } from "./settings-ui";
import {
  BoardData,
  DEFAULT_BOARD,
  DEFAULT_KEYBINDINGS,
  DEFAULT_THEME_COLORS,
  Item,
  KeyBinding,
  ShortcutActionId,
  ThemeColors,
} from "./types";

export interface MaguilanoteSettings {
  gridSnap: boolean;
  gridSize: number;
  defaultNoteWidth: number;
  templatesFolder: string;
  /** CSS font-family value, or "" to inherit Obsidian's font */
  fontFamily: string;
  theme: "dark" | "light";
  keybindings: Record<ShortcutActionId, KeyBinding | null>;
  /** customizable background colors, kept separately per theme */
  colors: { light: ThemeColors; dark: ThemeColors };
  /** deviceId of the preferred microphone for Record cards, "" = system default */
  defaultMicId: string;
  /** OpenAI API key, used only for "Transcribe text" on Record cards. Stored locally in data.json. */
  openaiApiKey: string;
}

const DEFAULT_SETTINGS: MaguilanoteSettings = {
  gridSnap: false,
  gridSize: 24,
  defaultNoteWidth: 260,
  templatesFolder: "Maguilanote Templates",
  fontFamily: "",
  theme: "dark",
  keybindings: { ...DEFAULT_KEYBINDINGS },
  colors: { light: { ...DEFAULT_THEME_COLORS.light }, dark: { ...DEFAULT_THEME_COLORS.dark } },
  defaultMicId: "",
  openaiApiKey: "",
};

export default class MaguilanotePlugin extends Plugin {
  settings: MaguilanoteSettings = DEFAULT_SETTINGS;
  /** internal clipboard shared across boards */
  clipboard: { items: Item[]; edges: BoardData["edges"] } | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_BOARD, (leaf) => new BoardView(leaf, this));
    this.registerExtensions(["board"], VIEW_TYPE_BOARD);

    this.addRibbonIcon("layout-dashboard", "Maguilanote: new board", () =>
      this.createBoard()
    );

    this.addCommand({
      id: "new-board",
      name: "New board",
      callback: () => this.createBoard(),
    });

    this.addCommand({
      id: "export-board-markdown",
      name: "Export current board to Markdown",
      checkCallback: (checking) => {
        const view = this.activeBoard();
        if (!view) return false;
        if (!checking) this.exportMarkdown(view);
        return true;
      },
    });

    this.addCommand({
      id: "save-board-as-template",
      name: "Save current board as template",
      checkCallback: (checking) => {
        const view = this.activeBoard();
        if (!view || !view.file) return false;
        if (!checking) this.saveAsTemplate(view.file);
        return true;
      },
    });

    this.addCommand({
      id: "new-board-from-template",
      name: "New board from template",
      callback: () => new TemplatePicker(this.app, this).open(),
    });

    this.addCommand({
      id: "zoom-to-fit",
      name: "Zoom to fit (current board)",
      checkCallback: (checking) => {
        const view = this.activeBoard();
        if (!view) return false;
        if (!checking) view.zoomToFit();
        return true;
      },
    });

    this.addSettingTab(new MaguilanoteSettingTab(this.app, this));

    // "New board" in the folder context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((mi) =>
            mi
              .setTitle("New Maguilanote board")
              .setIcon("layout-dashboard")
              .onClick(() => this.createBoard(file.path))
          );
        }
      })
    );
  }

  activeBoard(): BoardView | null {
    return this.app.workspace.getActiveViewOfType(BoardView);
  }

  async createBoard(folderPath?: string, name = "New board"): Promise<TFile> {
    const folder =
      folderPath ??
      this.app.workspace.getActiveFile()?.parent?.path ??
      "";
    const prefix = folder && folder !== "/" ? folder + "/" : "";
    let path = normalizePath(`${prefix}${name}.board`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${prefix}${name} ${i++}.board`);
    }
    const file = await this.app.vault.create(
      path,
      JSON.stringify(DEFAULT_BOARD, null, 2)
    );
    await this.app.workspace.getLeaf(false).openFile(file);
    return file;
  }

  async saveAsTemplate(file: TFile) {
    const folder = normalizePath(this.settings.templatesFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    let target = normalizePath(`${folder}/${file.basename}.board`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(target)) {
      target = normalizePath(`${folder}/${file.basename} ${i++}.board`);
    }
    await this.app.vault.copy(file, target);
    new Notice(`Template saved to ${target}`);
  }

  async exportMarkdown(view: BoardView) {
    const data = view.board;
    const lines: string[] = [`# ${view.file?.basename ?? "Board"}`, ""];
    const roots = data.items
      .filter((it) => !it.parent)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const renderItem = (it: Item, indent: string) => {
      switch (it.type) {
        case "note":
        case "comment":
          lines.push(
            ...(it.text ?? "")
              .split("\n")
              .map((l) => indent + (it.type === "comment" ? "> 💬 " : "") + l)
          );
          break;
        case "todo":
          if (it.title) lines.push(`${indent}**${it.title}**`);
          for (const t of it.todos ?? [])
            lines.push(`${indent}- [${t.done ? "x" : " "}] ${t.text}`);
          break;
        case "link":
          lines.push(`${indent}[${it.title || it.url}](${it.url})`);
          break;
        case "image":
          lines.push(`${indent}![[${it.path}]]`);
          break;
        case "file":
          lines.push(`${indent}[[${it.path}]]`);
          break;
        case "board":
          lines.push(`${indent}📋 [[${it.path}|${it.title || it.path}]]`);
          break;
        case "swatch":
          lines.push(`${indent}🎨 \`${it.swatch}\``);
          break;
      }
      lines.push("");
    };
    for (const it of roots) {
      if (it.type === "column") {
        lines.push(`## ${it.title || "Column"}`, "");
        const children = data.items
          .filter((c) => c.parent === it.id)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        for (const c of children) renderItem(c, "");
      } else {
        renderItem(it, "");
      }
    }
    const base = view.file?.parent?.path
      ? view.file.parent.path + "/"
      : "";
    let path = normalizePath(`${base}${view.file?.basename ?? "board"} (export).md`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(
        `${base}${view.file?.basename ?? "board"} (export ${i++}).md`
      );
    }
    const f = await this.app.vault.create(path, lines.join("\n"));
    await this.app.workspace.getLeaf("tab").openFile(f);
    new Notice("Board exported to Markdown");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.keybindings = Object.assign(
      {},
      DEFAULT_KEYBINDINGS,
      this.settings.keybindings
    );
    this.settings.colors = {
      light: Object.assign({}, DEFAULT_THEME_COLORS.light, this.settings.colors?.light),
      dark: Object.assign({}, DEFAULT_THEME_COLORS.dark, this.settings.colors?.dark),
    };
  }

  /** re-apply appearance (theme/font) to every open board and refresh keyboard shortcuts */
  refreshBoards() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
      if (leaf.view instanceof BoardView) leaf.view.applyAppearance();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class TemplatePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: MaguilanotePlugin) {
    super(app);
    this.setPlaceholder("Choose a template...");
  }
  getItems(): TFile[] {
    const folder = normalizePath(this.plugin.settings.templatesFolder);
    return this.app.vault
      .getFiles()
      .filter((f) => f.extension === "board" && f.path.startsWith(folder));
  }
  getItemText(f: TFile): string {
    return f.basename;
  }
  async onChooseItem(f: TFile) {
    const raw = await this.app.vault.read(f);
    const folder = this.app.workspace.getActiveFile()?.parent?.path ?? "";
    const prefix = folder && folder !== "/" ? folder + "/" : "";
    let path = normalizePath(`${prefix}${f.basename}.board`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${prefix}${f.basename} ${i++}.board`);
    }
    const nf = await this.app.vault.create(path, raw);
    await this.app.workspace.getLeaf(false).openFile(nf);
  }
}

class MaguilanoteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MaguilanotePlugin) {
    super(app, plugin);
  }
  display() {
    renderSettingsUI(this.containerEl, this.plugin);
  }
}
