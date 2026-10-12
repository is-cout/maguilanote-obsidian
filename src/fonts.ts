/** Loads a Google Font by family name, once per name.
 *
 * A plugin may not create <link> or <style> elements to load CSS, so the Google
 * Fonts stylesheet is fetched with `requestUrl`, its @font-face rules are parsed,
 * and each face is registered through the FontFace API (`Document.fonts`) of the
 * window showing the board, so popout windows get their own copy. */

import { requestUrl } from "obsidian";

/** "<family>" requested per document (main window and each popout load separately) */
const loadedFonts = new Map<Document, Set<string>>();

/** faces this module registered, so `removeGoogleFonts` can undo them on unload */
const registered: { face: FontFace; doc: Document }[] = [];

/** Google Fonts family names are plain words/spaces; anything else (a CSS
 * `var(...)` reference, a font stack with commas, or empty) isn't a Google Font request. */
function isGoogleFontName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && !n.startsWith("var(") && !n.includes(",");
}

/** Pulls (weight, source-url) out of the @font-face blocks of a css2 response.
 * Google returns one block per weight/subset; the latin subsets are last, and
 * later blocks win in CSS, so registering every block in order keeps that order. */
function parseFaces(css: string): { weight: string; url: string }[] {
  const faces: { weight: string; url: string }[] = [];
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const url = block.match(/src:[^;]*url\(([^)]+)\)/)?.[1];
    if (!url) continue;
    faces.push({ weight: block.match(/font-weight:\s*([^;]+);/)?.[1].trim() ?? "400", url });
  }
  return faces;
}

export function ensureGoogleFont(name: string, doc: Document) {
  const n = name.trim();
  const loaded = loadedFonts.get(doc) ?? new Set<string>();
  if (!isGoogleFontName(n) || loaded.has(n)) return;
  loaded.add(n);
  loadedFonts.set(doc, loaded);
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(n).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  void requestUrl({ url })
    .then(async (res) => {
      for (const f of parseFaces(res.text)) {
        const face = new FontFace(n, `url(${f.url})`, { weight: f.weight, display: "swap" });
        await face.load();
        doc.fonts.add(face);
        registered.push({ face, doc });
      }
    })
    .catch(() => {
      // offline, unknown family, or a face that failed to load: the font stack
      // falls back to sans-serif
      loaded.delete(n); // allow a retry on the next render
    });
}

export function removeGoogleFonts() {
  for (const { face, doc } of registered) doc.fonts.delete(face);
  registered.length = 0;
  loadedFonts.clear();
}

/** CSS `font-family` value for a settings font field: quotes bare Google Font
 * names, passes through `var(...)`/font-stack values and "" as-is. */
export function fontFamilyValue(name: string): string {
  const n = name.trim();
  if (!n) return "inherit";
  if (n.startsWith("var(") || n.includes(",")) return n;
  return `"${n}", sans-serif`;
}
