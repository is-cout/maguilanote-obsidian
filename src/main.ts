import {
  App,
  FuzzySuggestModal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./board-view";
import { renderSettingsUI } from "./settings-ui";
import { loadOpenAiApiKey } from "./secrets";
import { removeGoogleFonts } from "./fonts";
import { ImportTemplateConfirmModal, TextPromptModal } from "./modals";
import { TemplateBundle, collectBundle, unbundleTemplate } from "./template-bundle";
import {
  BoardData,
  DEFAULT_BOARD,
  DEFAULT_KEYBINDINGS,
  DEFAULT_THEME_COLORS,
  Item,
  KeyBinding,
  newId,
  ShortcutActionId,
  ThemeColors,
} from "./types";

export interface MaguilanoteSettings {
  gridSnap: boolean;
  gridSize: number;
  defaultNoteWidth: number;
  templatesFolder: string;
  /** vault folder where dropped files and recordings are saved */
  assetsFolder: string;
  /** body text font: a value from FONT_CHOICES, a Google Font family name
   * (e.g. "Inter"), or "" to inherit Obsidian's font */
  fontFamily: string;
  /** heading font (card titles, column titles): same value shapes as fontFamily,
   * "" falls back to the body font */
  headingFontFamily: string;
  theme: "dark" | "light";
  keybindings: Record<ShortcutActionId, KeyBinding | null>;
  /** customizable background colors, kept separately per theme */
  colors: { light: ThemeColors; dark: ThemeColors };
  /** deviceId of the preferred microphone for Record cards, "" = system default */
  defaultMicId: string;
  /** OpenAI API key, used only for "Transcribe text" on Record cards.
   * Mobile-only fallback: on desktop the key lives outside the vault
   * (see src/secrets.ts) so it isn't swept into vault backups; this field
   * exists because mobile has no filesystem access outside the vault. */
  openaiApiKey: string;
}

const DEFAULT_SETTINGS: MaguilanoteSettings = {
  gridSnap: false,
  gridSize: 24,
  defaultNoteWidth: 260,
  templatesFolder: "Maguilanote Templates",
  assetsFolder: "Maguilanote Assets",
  fontFamily: "",
  headingFontFamily: "",
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

  /** desktop: key lives outside the vault (src/secrets.ts); mobile: settings fallback */
  getOpenAiApiKey(): string {
    return Platform.isDesktopApp ? loadOpenAiApiKey() : this.settings.openaiApiKey;
  }

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
      id: "export-board-json-canvas",
      name: "Export current board to JSON Canvas",
      checkCallback: (checking) => {
        const view = this.activeBoard();
        if (!view || !view.file) return false;
        if (!checking) void this.exportJsonCanvas(view).catch((error) => {
          new Notice(`JSON Canvas export failed: ${error instanceof Error ? error.message : "unknown error"}`);
        });
        return true;
      },
    });

    this.addCommand({
      id: "import-json-canvas",
      name: "Import JSON Canvas into current board",
      checkCallback: (checking) => {
        const view = this.activeBoard();
        if (!view) return false;
        if (!checking) new JsonCanvasPicker(this.app, this).open();
        return true;
      },
    });

    this.addCommand({
      id: "save-board-as-template",
      name: "Save current board as template",
      checkCallback: (checking) => {
        const view = this.activeBoard();
        if (!view || !view.file) return false;
        if (!checking) this.exportBoardAsTemplate(view);
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

    // a board renamed anywhere (our breadcrumb right-click or Obsidian's file
    // explorer) leaves stale paths in other .board files and breadcrumb trails —
    // Obsidian's link updater only knows about links, not these JSON references
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        this.repairBoardRefs(file, oldPath)
      )
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

  /** Rename the current board in place (same folder). `fileManager.renameFile`
   * updates every markdown link to the board; references stored inside other
   * .board files and open breadcrumb trails are fixed by the vault "rename"
   * listener (repairBoardRefs), since Obsidian can't see those JSON paths. */
  renameBoard(view: BoardView) {
    const file = view.file;
    if (!file) return;
    new TextPromptModal(this.app, "Rename board", file.basename, async (name) => {
      if (!name || name === file.basename) return;
      const prefix = file.parent && file.parent.path !== "/" ? file.parent.path + "/" : "";
      const newPath = normalizePath(`${prefix}${name}.board`);
      if (this.app.vault.getAbstractFileByPath(newPath)) {
        new Notice(`"${name}.board" already exists in that folder`);
        return;
      }
      try {
        await this.app.fileManager.renameFile(file, newPath);
      } catch (e) {
        new Notice(`Rename failed: ${e instanceof Error ? e.message : e}`);
      }
    }).open();
  }

  /**
   * After a .board file is renamed by any means, repair the references Obsidian
   * can't reach: nested board cards (`type: "board"`, stored as plain JSON paths)
   * inside other .board files, and the breadcrumb trails of open board views.
   * Titles are refreshed only when they still match the old basename, so a card
   * the user has given a custom title keeps it.
   */
  private async repairBoardRefs(file: TAbstractFile, oldPath: string) {
    if (!(file instanceof TFile) || file.extension !== "board") return;

    const views = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_BOARD)
      .map((leaf) => leaf.view)
      .filter((v): v is BoardView => v instanceof BoardView);
    for (const view of views) {
      let touched = false;
      for (const c of view.crumbs) {
        if (c.path === oldPath) {
          c.path = file.path;
          c.name = file.basename;
          touched = true;
        }
      }
      if (touched || view.file?.path === file.path) view.renderCrumbs();
    }

    const oldBasename = oldPath.split("/").pop()?.replace(/\.board$/i, "") ?? oldPath;
    const open = new Map<string, BoardView>(
      views
        .filter((v) => !!v.file)
        .map((v) => [v.file!.path, v])
    );

    for (const f of this.app.vault.getFiles()) {
      if (f.extension !== "board") continue;
      let raw: string;
      try {
        raw = await this.app.vault.read(f);
      } catch {
        continue;
      }
      if (!raw.includes(oldPath)) continue;
      let data: BoardData;
      try {
        data = JSON.parse(raw);
      } catch {
        continue; // corrupt file — never rewrite it
      }
      if (!Array.isArray(data.items)) continue;
      const openView = open.get(f.path);
      if (openView) {
        let dirty = false;
        for (const it of openView.board.items) {
          if (it.type === "board" && it.path === oldPath) {
            it.path = file.path;
            if (it.title === oldBasename) it.title = file.basename;
            dirty = true;
          }
        }
        if (dirty) openView.commit(); // saves through the view's own pipeline
        continue;
      }
      let dirty = false;
      for (const it of data.items) {
        if (it.type === "board" && it.path === oldPath) {
          it.path = file.path;
          if (it.title === oldBasename) it.title = file.basename;
          dirty = true;
        }
      }
      if (!dirty) continue;
      try {
        await this.app.vault.modify(f, JSON.stringify(data, null, 2));
      } catch {
        // leave this board alone; the next rename will retry
      }
    }
  }

  /** Bundles `view`'s board and everything it references (nested boards, images, files, recordings) into a single `.board.template` in the templates folder. */
  async exportBoardAsTemplate(view: BoardView) {
    await view.save(); // flush the debounced autosave — collectBundle reads the file from disk
    const file = view.file;
    if (!file) return;
    const bundle = await collectBundle(this.app, file);
    const folder = normalizePath(this.settings.templatesFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    let target = normalizePath(`${folder}/${file.basename}.board.template`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(target)) {
      target = normalizePath(`${folder}/${file.basename} ${i++}.board.template`);
    }
    await this.app.vault.create(target, JSON.stringify(bundle, null, 2));
    new Notice(`Template saved to ${target}`);
  }

  /**
   * Opens a file picker restricted to `.board.template` files (native dialog on
   * desktop, defaulting to the templates folder; browser file input otherwise).
   * Importing replaces `view`'s board: the picked template is unpacked next to
   * it, opened in its place, and the board it replaces is trashed.
   */
  async openImportTemplateDialog(view: BoardView) {
    if (Platform.isDesktopApp) {
      const picked = this.pickTemplateFileDesktop();
      if (picked !== undefined) {
        if (picked === null) return; // user cancelled the native dialog
        const fs = require("fs");
        const path = require("path");
        const raw: string = fs.readFileSync(picked, "utf8");
        await this.importTemplateFile(raw, path.basename(picked).replace(/\.board\.template$/i, ""), view);
        return;
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".template";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const raw = await file.text();
      await this.importTemplateFile(raw, file.name.replace(/\.board\.template$/i, ""), view);
    };
    input.click();
  }

  /** Native Electron open-dialog, defaulting to the templates folder on disk. Returns `undefined` if Electron's dialog isn't available (caller should fall back), `null` if the user cancelled, or the chosen absolute path. */
  private pickTemplateFileDesktop(): string | null | undefined {
    try {
      const electron = (window as any).require("electron");
      const dialog = electron.remote?.dialog ?? electron.dialog;
      if (!dialog?.showOpenDialogSync) return undefined;
      const adapter = this.app.vault.adapter as any;
      let defaultPath: string | undefined;
      if (adapter?.basePath) {
        const path = require("path");
        const folder = this.settings.templatesFolder?.trim();
        defaultPath = folder ? path.join(adapter.basePath, folder) : adapter.basePath;
      }
      const result = dialog.showOpenDialogSync({
        title: "Import Maguilanote template",
        defaultPath,
        filters: [{ name: "Maguilanote template", extensions: ["template"] }],
        properties: ["openFile"],
      });
      return result?.[0] ?? null;
    } catch {
      return undefined;
    }
  }

  /**
   * Validates `raw` as a template bundle, warns the user before writing anything
   * (it replaces `view`'s current board), then unpacks it next to `view`'s file,
   * opens the result in `view`'s place, and trashes the board it replaced.
   */
  async importTemplateFile(raw: string, displayName: string, view: BoardView) {
    let bundle: TemplateBundle;
    try {
      bundle = JSON.parse(raw);
      if (bundle.format !== "maguilanote-template") throw new Error("not a template");
    } catch {
      new Notice("Not a valid Maguilanote template file");
      return;
    }
    new ImportTemplateConfirmModal(this.app, displayName, async () => {
      try {
        const oldFile = view.file;
        const destFolder = oldFile?.parent?.path ?? "";
        const rootFile = await unbundleTemplate(this.app, bundle, destFolder);
        await view.leaf.openFile(rootFile);
        if (oldFile && oldFile.path !== rootFile.path) {
          await this.app.vault.trash(oldFile, false); // Obsidian's trash, not the OS trash
        }
        new Notice(`Imported template "${displayName}"`);
      } catch (e) {
        console.error("Maguilanote: template import failed", e);
        new Notice(`Failed to import template: ${e instanceof Error ? e.message : e}`);
      }
    }).open();
  }

  async importJsonCanvas(file: TFile, view: BoardView) {
    try {
      const data = JSON.parse(await this.app.vault.read(file));
      if (!data || !Array.isArray(data.nodes)) throw new Error("invalid JSON Canvas");
      const canvasEdges = Array.isArray(data.edges) ? data.edges : [];
      const ids = new Map<string, string>();
      const seenNodeIds = new Set<string>();
      const groups = new Map<string, Item>();
      const imported: Item[] = [];
      for (const node of data.nodes) {
        if (!node || typeof node !== "object" || typeof node.id !== "string" || seenNodeIds.has(node.id) || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !["text", "file", "link", "group"].includes(node.type)) continue;
        seenNodeIds.add(node.id);
        const id = newId();
        const item: Item = {
          id, type: node.type === "group" ? "column" : node.type === "file" ? "file" : node.type === "link" ? "link" : "note",
          x: node.x, y: node.y, w: Number.isFinite(node.width) ? Math.max(120, node.width) : 260,
          h: Number.isFinite(node.height) ? Math.max(48, node.height) : undefined,
        };
        if (item.type === "note") item.text = typeof node.text === "string" ? node.text : "";
        if (item.type === "file") {
          if (typeof node.file !== "string" || !node.file.trim()) continue;
          item.path = node.file;
        }
        if (item.type === "link") {
          if (typeof node.url !== "string" || !/^https?:\/\//i.test(node.url)) continue;
          item.url = node.url;
        }
        if (node.type === "group") { item.title = typeof node.label === "string" ? node.label : "Column"; groups.set(node.id, item); }
        if (item.type === "file" && !this.resolveImportedPath(item.path)) continue;
        ids.set(node.id, id);
        imported.push(item);
      }
      for (const node of data.nodes) {
        if (node?.type !== "group" || !Array.isArray(node.children)) continue;
        const parent = groups.get(node.id);
        if (!parent) continue;
        for (const childId of node.children) {
          const child = typeof childId === "string" ? imported.find((it) => it.id === ids.get(childId)) : undefined;
          if (child && child.id !== parent.id) child.parent = parent.id;
        }
      }
      const edges = canvasEdges.flatMap((edge: any) => {
        if (!edge || typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") return [];
        const from = ids.get(edge.fromNode), to = ids.get(edge.toNode);
        return from && to ? [{ id: newId(), from, to, arrow: true, mode: "free" as const, label: typeof edge.label === "string" ? edge.label : undefined }] : [];
      });
      if (!imported.length) throw new Error("no compatible nodes");
      view.board.items.push(...imported);
      view.board.edges.push(...edges);
      view.selection = new Set(imported.map((it) => it.id));
      view.commit();
      new Notice(`Imported ${imported.length} JSON Canvas nodes`);
    } catch (error) {
      new Notice(`JSON Canvas import failed: ${error instanceof Error ? error.message : "invalid file"}`);
    }
  }

  private resolveImportedPath(path?: string): string | undefined {
    const normalized = path?.trim();
    return normalized && !normalized.startsWith("/") && !normalized.includes("..") ? normalized : undefined;
  }

  async exportJsonCanvas(view: BoardView) {
    const nodes: Record<string, unknown>[] = [];
    const groups = new Map<string, Record<string, unknown>>();
    const nodeIds = new Set<string>();
    for (const it of view.board.items) {
      if (nodeIds.has(it.id)) continue;
      nodeIds.add(it.id);
      if (it.type === "column") {
        const group = { id: it.id, type: "group", x: it.x, y: it.y, width: it.w, height: it.h ?? 300, label: it.title || "Column", children: [] as string[] };
        groups.set(it.id, group);
        nodes.push(group);
        continue;
      }
      const base = { id: it.id, x: it.x, y: it.y, width: it.w, height: it.h ?? 120 };
      if (it.type === "note" || it.type === "comment" || it.type === "todo")
        nodes.push({ ...base, type: "text", text: it.text || (it.todos ?? []).map((t) => `- [${t.done ? "x" : " "}] ${t.text}`).join("\n") });
      else if (it.path) nodes.push({ ...base, type: "file", file: it.path });
      else if (it.url) nodes.push({ ...base, type: "link", url: it.url });
      else nodes.push({ ...base, type: "text", text: it.title || it.type });
    }
    for (const it of view.board.items) {
      if (it.parent && groups.has(it.parent)) {
        const group = groups.get(it.parent)!;
        (group.children as string[]).push(it.id);
      }
    }
    const edges = view.board.edges
      .filter((e) => e.from && e.to)
      .map((e) => ({
        id: e.id,
        fromNode: e.from,
        toNode: e.to,
        fromSide: "right",
        toSide: "left",
        label: e.label,
      }));
    const base = view.file?.parent?.path ? `${view.file.parent.path}/` : "";
    let path = normalizePath(`${base}${view.file?.basename ?? "board"} (export).canvas`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(
        `${base}${view.file?.basename ?? "board"} (export ${i++}).canvas`
      );
    }
    const file = await this.app.vault.create(path, JSON.stringify({ nodes, edges }, null, 2));
    await this.app.workspace.getLeaf("tab").openFile(file);
    new Notice("Board exported to JSON Canvas");
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
    this.settings.gridSize = Number.isFinite(this.settings.gridSize) && this.settings.gridSize > 0 ? this.settings.gridSize : DEFAULT_SETTINGS.gridSize;
    this.settings.defaultNoteWidth = Number.isFinite(this.settings.defaultNoteWidth) && this.settings.defaultNoteWidth > 0 ? this.settings.defaultNoteWidth : DEFAULT_SETTINGS.defaultNoteWidth;
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

  onunload() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
      if (leaf.view instanceof BoardView) void leaf.view.onClose();
    }
    removeGoogleFonts(); // drop the <style> elements injected into document.head
  }
}

class JsonCanvasPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: MaguilanotePlugin) { super(app); this.setPlaceholder("Choose a .canvas file..."); }
  getItems() { return this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "canvas"); }
  getItemText(f: TFile) { return f.path; }
  onChooseItem(f: TFile) {
    const view = this.plugin.activeBoard();
    if (view) void this.plugin.importJsonCanvas(f, view);
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
      .filter((f) => f.path.startsWith(folder) && f.path.toLowerCase().endsWith(".board.template"));
  }
  getItemText(f: TFile): string {
    return f.name.replace(/\.board\.template$/i, "");
  }
  async onChooseItem(f: TFile) {
    const raw = await this.app.vault.read(f);
    let bundle: TemplateBundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      new Notice("Invalid template file");
      return;
    }
    const folder = this.app.workspace.getActiveFile()?.parent?.path ?? "";
    const nf = await unbundleTemplate(this.app, bundle, folder);
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
