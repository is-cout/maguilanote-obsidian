import { App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";

export class TextPromptModal extends Modal {
  constructor(
    app: App,
    private promptTitle: string,
    private initial: string,
    private cb: (v: string) => void
  ) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText(this.promptTitle);
    let value = this.initial;
    new Setting(this.contentEl).addText((t) => {
      t.setValue(this.initial).onChange((v) => (value = v));
      t.inputEl.style.width = "100%";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.close();
          this.cb(value.trim());
        }
      });
      window.setTimeout(() => t.inputEl.focus(), 10);
    });
    new Setting(this.contentEl)
      .addButton((b) =>
        b.setButtonText("OK").setCta().onClick(() => {
          this.close();
          this.cb(value.trim());
        })
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class VaultFilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private cb: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose a file from the vault...");
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles();
  }
  getItemText(f: TFile): string {
    return f.path;
  }
  onChooseItem(f: TFile) {
    this.cb(f);
  }
}

export class ShortcutsModal extends Modal {
  onOpen() {
    this.titleEl.setText("Maguilanote shortcuts");
    const rows: [string, string][] = [
      ["Double-click canvas", "New note"],
      ["Click a card", "Select (then drag to move)"],
      ["Double-click a card", "Edit note / open board / preview file"],
      ["Ctrl+click file/board card", "Open the real file in a new tab"],
      ["Drag a toolbar button", "Create the element where you drop it"],
      ["Alt+drag a card", "Duplicate while dragging"],
      ["Ctrl while dragging", "Invert snap-to-grid"],
      ["D", "Draw on the board"],
      ["Drag the blue dot", "Draw an arrow (drop on empty canvas for a free end)"],
      ["Drag the Line tool", "Add a line, then drag its ends to connect cards"],
      ["Drag a line's middle dot", "Curve it (Free lines only)"],
      ["Double-click an arrow", "Edit its label"],
      ["Right-click an arrow", "Line menu (color, arrowhead, dashed, Free/Smart routing...)"],
      ["Ctrl+Z / Ctrl+Shift+Z", "Undo / Redo"],
      ["Ctrl+C / X / V / D", "Copy / Cut / Paste / Duplicate"],
      ["Ctrl+A", "Select all"],
      ["Ctrl+F", "Search this board"],
      ["Delete", "Delete selection"],
      ["Arrow keys (+Shift)", "Nudge selection 1px (10px)"],
      ["Ctrl+scroll", "Zoom"],
      ["Scroll / middle mouse / Space+drag", "Pan"],
      ["Right-click", "Card menu (color, lock, order, replace reference...)"],
    ];
    const table = this.contentEl.createEl("table", { cls: "mgn-shortcuts" });
    for (const [k, v] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k, cls: "mgn-shortcut-key" });
      tr.createEl("td", { text: v });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}
