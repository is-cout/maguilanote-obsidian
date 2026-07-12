import { MarkdownRenderer } from "obsidian";
import type { BoardView } from "./board-view";
import { AUDIO_EXTS, IMAGE_EXTS, Item, VIDEO_EXTS } from "./types";
import { VaultFilePicker } from "./modals";

/** re-pick the vault file a card points to (broken/renamed references) */
export function relinkItem(view: BoardView, it: Item) {
  new VaultFilePicker(view.app, (f) => {
    it.path = f.path;
    if (it.type === "board") it.title = f.basename;
    view.commit();
  }).open();
}

/** inline preview overlay (double-click on a vault file card) */
export async function openPreviewFor(view: BoardView, it: Item) {
  if (it.type === "board") {
    const bf = view.resolveFile(it.path);
    if (bf) view.navigateTo(bf);
    else view.relinkItem(it);
    return;
  }
  const f = view.resolveFile(it.path);
  if (!f) {
    // broken reference: let the user re-pick the file
    view.relinkItem(it);
    return;
  }
  view.closePreview();
  const ov = view.contentEl.createDiv({ cls: "mgn-preview" });
  const panel = ov.createDiv({ cls: "mgn-preview-panel" });
  const head = panel.createDiv({ cls: "mgn-preview-head" });
  const crumb = head.createDiv({ cls: "mgn-preview-crumbs" });
  crumb.createSpan({ cls: "mgn-crumb", text: view.file?.basename ?? "Board" });
  crumb.createSpan({ cls: "mgn-crumb-sep", text: "›" });
  crumb.createSpan({ cls: "mgn-crumb-current", text: f.name });
  const actions = head.createDiv({ cls: "mgn-preview-actions" });
  const openBtn = actions.createEl("button", { text: "Open in Obsidian" });
  openBtn.addEventListener("click", () => {
    view.closePreview();
    view.app.workspace.getLeaf("tab").openFile(f);
  });
  const closeBtn = actions.createEl("button", { cls: "mgn-preview-close", text: "✕" });
  closeBtn.addEventListener("click", () => view.closePreview());
  ov.addEventListener("click", (e) => {
    if (e.target === ov) view.closePreview();
  });
  const body = panel.createDiv({ cls: "mgn-preview-body markdown-rendered" });
  const ext = f.extension.toLowerCase();
  if (ext === "md") {
    const text = await view.app.vault.cachedRead(f);
    await MarkdownRenderer.render(view.app, text, body, f.path, view);
  } else if (IMAGE_EXTS.includes(ext)) {
    body.createEl("img", {
      cls: "mgn-preview-media",
      attr: { src: view.app.vault.getResourcePath(f) },
    });
  } else if (AUDIO_EXTS.includes(ext)) {
    body.createEl("audio", {
      cls: "mgn-preview-media",
      attr: { controls: "true", src: view.app.vault.getResourcePath(f) },
    });
  } else if (VIDEO_EXTS.includes(ext)) {
    body.createEl("video", {
      cls: "mgn-preview-media",
      attr: { controls: "true", src: view.app.vault.getResourcePath(f) },
    });
  } else if (ext === "pdf") {
    body.addClass("mgn-preview-body-pdf");
    await MarkdownRenderer.render(view.app, `![[${f.path}]]`, body, f.path, view);
  } else {
    body.createDiv({ text: `No preview available for .${ext} files.` });
  }
}

export function closePreview(view: BoardView) {
  view.contentEl.querySelector(".mgn-preview")?.remove();
}
