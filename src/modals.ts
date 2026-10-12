import { App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import type MaguilanotePlugin from "./main";
import { renderSettingsUI } from "./settings-ui";

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
      t.inputEl.addClass("mgn-prompt-input");
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

export class ColorPromptModal extends Modal {
  constructor(
    app: App,
    private initial: string,
    private cb: (value: string) => void,
  ) { super(app); }

  onOpen() {
    this.titleEl.setText("Choose color");
    const value = /^#[0-9a-f]{6}$/i.test(this.initial) ? this.initial : "#cccccc";
    const row = this.contentEl.createDiv({ cls: "mgn-color-prompt" });
    row.createEl("input", { type: "color", value, attr: { "aria-label": "Color spectrum" } });
    const hex = row.createEl("input", {
      type: "text", value, placeholder: "#RRGGBB", cls: "mgn-prompt-input",
      attr: { "aria-label": "Hex color" },
    });
    const picker = row.querySelector<HTMLInputElement>('input[type="color"]')!;
    const normalize = (v: string) => {
      const next = v.startsWith("#") ? v : `#${v}`;
      return /^#[0-9a-f]{6}$/i.test(next) ? next : null;
    };
    let hexTouched = false;
    picker.addEventListener("input", () => { hex.value = picker.value; });
    picker.addEventListener("change", () => { hex.value = picker.value; });
    hex.addEventListener("input", () => { hexTouched = true; });
    // iPadOS can report stale input/change values for color pickers, so the OK
    // action reads the live picker value unless the user typed the hex field.
    const ok = () => {
      const next = hexTouched ? (normalize(hex.value) ?? normalize(picker.value)) : normalize(picker.value);
      if (!next) { hex.focus(); return; }
      this.close(); this.cb(next);
    };
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("OK").setCta().onClick(ok))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    hex.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); ok(); }
    });
  }

  onClose() { this.contentEl.empty(); }
}

export class ImportTemplateConfirmModal extends Modal {
  constructor(app: App, private name: string, private onConfirm: () => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText("Import template?");
    this.contentEl.createEl("p", {
      text:
        `You're about to import "${this.name}", replacing the board you currently have open. ` +
        "Only import templates from people you trust — a template file can bundle files of any type, " +
        "and importing writes them into your vault.",
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Import")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
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

export class SettingsModal extends Modal {
  constructor(app: App, private plugin: MaguilanotePlugin) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Maguilanote settings");
    this.modalEl.addClass("mgn-settings-modal");
    renderSettingsUI(this.contentEl, this.plugin);
  }

  onClose() {
    this.contentEl.empty();
  }
}
