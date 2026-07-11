import { App, TFile, normalizePath } from "obsidian";
import { BoardData, Item } from "./types";

/**
 * A .board.template file: the root board plus every board/asset it
 * references (recursively through nested "board" items), so the whole
 * template is portable in one file. Keys are the ORIGINAL vault paths at
 * export time; `unbundleTemplate` remaps them to fresh destination paths
 * and rewrites `Item.path` references accordingly.
 */
export interface TemplateBundle {
  format: "maguilanote-template";
  version: 1;
  root: string; // original vault path of the root board
  boards: Record<string, string>; // original path -> raw board JSON text
  assets: Record<string, string>; // original path -> base64 content
}

const ASSET_ITEM_TYPES = new Set(["image", "file", "record"]);

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Recursively walks `rootFile` and every board/asset it references, into a single portable bundle. */
export async function collectBundle(app: App, rootFile: TFile): Promise<TemplateBundle> {
  const boards: Record<string, string> = {};
  const assets: Record<string, string> = {};

  const visitBoard = async (file: TFile) => {
    if (boards[file.path] !== undefined) return; // already visited (cycle guard)
    const raw = await app.vault.read(file);
    boards[file.path] = raw;
    let data: BoardData;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    for (const it of data.items ?? []) {
      if (!it.path) continue;
      const f = app.vault.getAbstractFileByPath(it.path);
      if (!(f instanceof TFile)) continue;
      if (it.type === "board") {
        await visitBoard(f);
      } else if (ASSET_ITEM_TYPES.has(it.type) && assets[it.path] === undefined) {
        assets[it.path] = arrayBufferToBase64(await app.vault.readBinary(f));
      }
    }
  };

  await visitBoard(rootFile);
  return { format: "maguilanote-template", version: 1, root: rootFile.path, boards, assets };
}

function dedupedTarget(app: App, taken: Set<string>, folder: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let target = normalizePath(folder ? `${folder}/${filename}` : filename);
  let i = 1;
  while (app.vault.getAbstractFileByPath(target) || taken.has(target)) {
    target = normalizePath(folder ? `${folder}/${stem} ${i++}${ext}` : `${stem} ${i++}${ext}`);
  }
  taken.add(target);
  return target;
}

/**
 * Unpacks a bundle into `destFolder` (flat — matches the existing "Save as
 * template" convention, no attempt to reproduce the original folder tree),
 * remapping every `Item.path` reference to the new locations, and returns
 * the root board's new file.
 */
export async function unbundleTemplate(app: App, bundle: TemplateBundle, destFolder: string): Promise<TFile> {
  const folder = normalizePath(destFolder);
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder).catch(() => {});
  }

  const remap = new Map<string, string>();
  const taken = new Set<string>();

  const assetPaths = Object.keys(bundle.assets);
  const assetsFolder = normalizePath(folder ? `${folder}/assets` : "assets");
  if (assetPaths.length && !app.vault.getAbstractFileByPath(assetsFolder)) {
    await app.vault.createFolder(assetsFolder).catch(() => {});
  }
  for (const orig of assetPaths) {
    const name = orig.split("/").pop() || "asset";
    remap.set(orig, dedupedTarget(app, taken, assetsFolder, name));
  }

  let rootTarget = "";
  for (const orig of Object.keys(bundle.boards)) {
    const name = orig.split("/").pop() || "board";
    const filename = name.toLowerCase().endsWith(".board") ? name : `${name}.board`;
    const target = dedupedTarget(app, taken, folder, filename);
    remap.set(orig, target);
    if (orig === bundle.root) rootTarget = target;
  }

  for (const [orig, b64] of Object.entries(bundle.assets)) {
    await app.vault.createBinary(remap.get(orig)!, base64ToArrayBuffer(b64));
  }
  for (const [orig, raw] of Object.entries(bundle.boards)) {
    let data: BoardData | null = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // not valid JSON — write through unchanged, no path rewriting possible
    }
    if (data) {
      for (const it of data.items as Item[]) {
        if (it.path && remap.has(it.path)) it.path = remap.get(it.path);
      }
    }
    await app.vault.create(remap.get(orig)!, data ? JSON.stringify(data, null, 2) : raw);
  }

  const rootFile = app.vault.getAbstractFileByPath(rootTarget);
  if (!(rootFile instanceof TFile)) throw new Error("Template import failed: root board missing");
  return rootFile;
}
