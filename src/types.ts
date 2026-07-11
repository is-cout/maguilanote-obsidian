export type ItemType =
  | "note" | "image" | "link" | "file" | "column"
  | "todo" | "swatch" | "comment" | "board"
  | "drawing" | "sketch" | "record";

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
  /** show the optional title row (icon + title text) above the card's content.
   * Columns always show their title regardless of this field. */
  showTitle?: boolean;
  url?: string;
  path?: string;
  todos?: TodoEntry[];
  swatch?: string;
  strokes?: Stroke[]; // drawing / sketch freehand strokes (local coords)
  duration?: number; // record card: recording length in seconds
}

/** card types that support the optional title row (icon + editable title text).
 * link/file/board show a title-like head unconditionally (it's the card's primary
 * content, identifying the reference), so they're not part of this opt-in system. */
export const TITLE_ELIGIBLE_TYPES: ItemType[] = [
  "note", "comment", "todo", "image", "swatch", "sketch", "record",
];

/** default title text (placeholder) per card type, used when a title is shown
 * but the user hasn't typed one — the card's own name, still editable. */
export const TITLE_LABELS: Partial<Record<ItemType, string>> = {
  note: "Note",
  comment: "Comment",
  todo: "To-do",
  image: "Image",
  swatch: "Swatch",
  sketch: "Sketch",
  record: "Recording",
};

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

/** the non-"default" card color keys — also used as the field names on `ThemeColors` */
export const CUSTOM_CARD_COLOR_KEYS = [
  "yellow", "orange", "red", "purple", "blue", "teal", "green", "gray",
] as const;
export type CustomCardColorKey = (typeof CUSTOM_CARD_COLOR_KEYS)[number];

/** per-theme customizable colors (Settings → Customization). Backgrounds only —
 * card text color stays fixed for legibility. */
export interface ThemeColors {
  canvasBg: string;
  cardDefaultBg: string;
  yellow: string;
  orange: string;
  red: string;
  purple: string;
  blue: string;
  teal: string;
  green: string;
  gray: string;
}

// same defaults for both themes on purpose — only the "Default" card background
// differs (white on light, dark on dark), matching the pre-customization palette.
const SHARED_CARD_COLOR_DEFAULTS = {
  yellow: "#fff5c0",
  orange: "#ffd9b0",
  red: "#ffc7c2",
  purple: "#e2cbf7",
  blue: "#c4ddff",
  teal: "#bdede0",
  green: "#d3f2c0",
  gray: "#e4e4e8",
};

export const DEFAULT_THEME_COLORS: { light: ThemeColors; dark: ThemeColors } = {
  dark: { canvasBg: "#31303b", cardDefaultBg: "#4a4b54", ...SHARED_CARD_COLOR_DEFAULTS },
  light: { canvasBg: "#eceef2", cardDefaultBg: "#ffffff", ...SHARED_CARD_COLOR_DEFAULTS },
};

export const CARD_COLOR_NAMES: Record<CustomCardColorKey, string> = {
  yellow: "Yellow", orange: "Orange", red: "Red", purple: "Purple",
  blue: "Blue", teal: "Teal", green: "Green", gray: "Gray",
};

// bg is a CSS var, kept in sync with the active theme's ThemeColors by
// BoardView.applyAppearance(); fg is fixed (all card backgrounds here are light
// enough for dark text, "default" aside, which uses its own themed fg var).
export const CARD_COLORS: CardColor[] = [
  { key: "default", name: "Default", bg: "var(--mgn-card-default-bg)", fg: "var(--mgn-card-default-fg)" },
  ...CUSTOM_CARD_COLOR_KEYS.map((key) => ({
    key,
    name: CARD_COLOR_NAMES[key],
    bg: `var(--mgn-card-color-${key})`,
    fg: "#33343d",
  })),
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
