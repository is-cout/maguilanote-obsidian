import {
  App,
  FuzzySuggestModal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./board-view";
import { BoardData, DEFAULT_BOARD, Item } from "./types";

export interface MaguilanoteSettings {
  gridSnap: boolean;
  gridSize: number;
  defaultNoteWidth: number;
  templatesFolder: string;
}

const DEFAULT_SETTINGS: MaguilanoteSettings = {
  gridSnap: false,
  gridSize: 24,
  defaultNoteWidth: 260,
  templatesFolder: "Maguilanote Templates",
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
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Snap to grid")
      .setDesc("Snap cards to an invisible grid while dragging. Hold Ctrl while dragging to temporarily invert this mode.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.gridSnap).onChange(async (v) => {
          this.plugin.settings.gridSnap = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Grid size")
      .addSlider((s) =>
        s
          .setLimits(8, 64, 4)
          .setValue(this.plugin.settings.gridSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.gridSize = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default note width")
      .addSlider((s) =>
        s
          .setLimits(160, 480, 20)
          .setValue(this.plugin.settings.defaultNoteWidth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.defaultNoteWidth = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Templates folder")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.templatesFolder)
          .onChange(async (v) => {
            this.plugin.settings.templatesFolder = v || "Maguilanote Templates";
            await this.plugin.saveSettings();
          })
      );
  }
}
