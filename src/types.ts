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

export interface Edge {
  id: string;
  from: string;
  to: string;
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

export const CARD_COLORS: CardColor[] = [
  { key: "white", name: "White", bg: "#ffffff", fg: "#33343d" },
  { key: "yellow", name: "Yellow", bg: "#fff5c0", fg: "#33343d" },
  { key: "orange", name: "Orange", bg: "#ffd9b0", fg: "#33343d" },
  { key: "red", name: "Red", bg: "#ffc7c2", fg: "#33343d" },
  { key: "purple", name: "Purple", bg: "#e2cbf7", fg: "#33343d" },
  { key: "blue", name: "Blue", bg: "#c4ddff", fg: "#33343d" },
  { key: "teal", name: "Teal", bg: "#bdede0", fg: "#33343d" },
  { key: "green", name: "Green", bg: "#d3f2c0", fg: "#33343d" },
  { key: "gray", name: "Gray", bg: "#e4e4e8", fg: "#33343d" },
  { key: "dark", name: "Dark", bg: "#4a4b54", fg: "#f0f0f2" },
];

export function colorOf(key: string | undefined): CardColor {
  return CARD_COLORS.find((c) => c.key === key) ?? CARD_COLORS[0];
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
