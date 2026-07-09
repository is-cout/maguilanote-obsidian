export type ItemType =
  | "note" | "image" | "link" | "file" | "column"
  | "todo" | "swatch" | "comment" | "board"
  | "drawing" | "sketch";

export interface TodoEntry { text: string; done: boolean; }

/** One freehand stroke. Points are [x, y, pressure] in item-LOCAL coords. */
export interface Stroke {
  points: number[][];
  color: string;
  size: number;
}

// Drawing tunables — deliberately easy to change.
export const DRAW_GROUP_DISTANCE = 60; // px gap that groups strokes into one drawing item
export const STROKE_SIZES = [2, 4, 8, 14, 22]; // preset pen widths
export const DEFAULT_STROKE_SIZE = STROKE_SIZES[Math.floor(STROKE_SIZES.length / 2)];
export const DEFAULT_STROKE_COLOR = "#33343d";

export interface Item {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h?: number; // manual vertical size (min-height); content can still grow past it
  color?: string;
  locked?: boolean;
  parent?: string; // column id when stacked inside a column
  order?: number;
  text?: string;
  title?: string;
  url?: string;
  path?: string;
  todos?: TodoEntry[];
  swatch?: string;
  collapsed?: boolean;
  strokes?: Stroke[]; // drawing / sketch freehand strokes (local coords)
}

/** A world-space point used for a free (unanchored) line endpoint. */
export interface Point { x: number; y: number; }

/**
 * An edge/line. Each endpoint is EITHER anchored to an item (`from`/`to` id)
 * OR free-floating at a world point (`fromPt`/`toPt`). A standalone line
 * dropped from the toolbar starts with both endpoints free; dragging an
 * endpoint handle onto a card anchors that end to the card.
 *
 * `mode` picks the routing style: "free" draws a straight line clipped to
 * each end's boundary (optionally curved through `bend`); "smart" uses the
 * older routed-bezier logic that picks a face per side and bends around it.
 * Missing `mode` means "smart", for backward compatibility with boards saved
 * before this field existed — new lines are created with `mode: "free"`.
 * `bend` (free mode only) is a world point the line's midpoint is dragged
 * to, turning the straight segment into a curve.
 */
export interface Edge {
  id: string;
  from?: string;
  to?: string;
  fromPt?: Point;
  toPt?: Point;
  mode?: "free" | "smart";
  bend?: Point;
  label?: string;
  arrow?: boolean;
  dashed?: boolean;
  color?: string;
}

export interface BoardData { version: number; items: Item[]; edges: Edge[]; }

export const DEFAULT_BOARD: BoardData = { version: 1, items: [], edges: [] };

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
export const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "flac", "webm"];
export const VIDEO_EXTS = ["mp4", "mov", "mkv", "ogv"];

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface CardColor { key: string; name: string; bg: string; fg: string; }

// "default" resolves via CSS vars (--mgn-card-default-bg/fg), which flip between
// the old "white" and "dark" presets depending on the active board theme.
export const CARD_COLORS: CardColor[] = [
  { key: "default", name: "Default", bg: "var(--mgn-card-default-bg)", fg: "var(--mgn-card-default-fg)" },
  { key: "yellow", name: "Yellow", bg: "#fff5c0", fg: "#33343d" },
  { key: "orange", name: "Orange", bg: "#ffd9b0", fg: "#33343d" },
  { key: "red", name: "Red", bg: "#ffc7c2", fg: "#33343d" },
  { key: "purple", name: "Purple", bg: "#e2cbf7", fg: "#33343d" },
  { key: "blue", name: "Blue", bg: "#c4ddff", fg: "#33343d" },
  { key: "teal", name: "Teal", bg: "#bdede0", fg: "#33343d" },
  { key: "green", name: "Green", bg: "#d3f2c0", fg: "#33343d" },
  { key: "gray", name: "Gray", bg: "#e4e4e8", fg: "#33343d" },
];

// boards saved before "white"/"dark" were merged into "default" keep working
const LEGACY_COLOR_ALIASES: Record<string, string> = { white: "default", dark: "default" };

export function colorOf(key: string | undefined): CardColor {
  const k = key ? LEGACY_COLOR_ALIASES[key] ?? key : "default";
  return CARD_COLORS.find((c) => c.key === k) ?? CARD_COLORS[0];
}

// ---------------------------------------------------------------- shortcuts

/** A rebindable keyboard shortcut. `null` means "unbound". */
export interface KeyBinding { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; }

export type ShortcutActionId =
  | "undo" | "redo" | "duplicate" | "copy" | "cut" | "paste"
  | "selectAll" | "search" | "deleteSelection" | "drawMode" | "zoomReset";

export const SHORTCUT_LABELS: Record<ShortcutActionId, string> = {
  undo: "Undo",
  redo: "Redo",
  duplicate: "Duplicate selection",
  copy: "Copy",
  cut: "Cut",
  paste: "Paste",
  selectAll: "Select all",
  search: "Search this board",
  deleteSelection: "Delete selection",
  drawMode: "Enter draw mode",
  zoomReset: "Reset zoom to 100%",
};

export const DEFAULT_KEYBINDINGS: Record<ShortcutActionId, KeyBinding | null> = {
  undo: { key: "z", ctrl: true },
  redo: { key: "z", ctrl: true, shift: true },
  duplicate: { key: "d", ctrl: true },
  copy: { key: "c", ctrl: true },
  cut: { key: "x", ctrl: true },
  paste: { key: "v", ctrl: true },
  selectAll: { key: "a", ctrl: true },
  search: { key: "f", ctrl: true },
  deleteSelection: { key: "delete" },
  drawMode: { key: "d" },
  zoomReset: { key: "0", ctrl: true },
};

/** Human-readable label for a binding, e.g. "Ctrl+Shift+Z". Empty string if unbound. */
export function keyBindingLabel(b: KeyBinding | null | undefined): string {
  if (!b) return "";
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.alt) parts.push("Alt");
  if (b.shift) parts.push("Shift");
  const key = b.key === " " ? "Space" : b.key.length === 1 ? b.key.toUpperCase() : b.key;
  parts.push(key);
  return parts.join("+");
}

/** True if the keydown event matches the given binding. */
export function matchesBinding(e: KeyboardEvent, b: KeyBinding | null | undefined): boolean {
  if (!b) return false;
  if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
  const mod = e.ctrlKey || e.metaKey;
  if (!!b.ctrl !== mod) return false;
  if (!!b.shift !== e.shiftKey) return false;
  if (!!b.alt !== e.altKey) return false;
  return true;
}

export function parseBoard(raw: string): BoardData {
  if (!raw || !raw.trim()) return structuredClone(DEFAULT_BOARD);
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.items)) d.items = [];
    if (!Array.isArray(d.edges)) d.edges = [];
    d.version = d.version ?? 1;
    return d as BoardData;
  } catch {
    return structuredClone(DEFAULT_BOARD);
  }
}
