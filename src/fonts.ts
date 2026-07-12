/** Loads a Google Font by family name, once per name.
 *
 * The stylesheet is fetched with `requestUrl` and injected as a <style> element:
 * plugins may not create <link> elements to load CSS. */

import { requestUrl } from "obsidian";

const loadedFonts = new Set<string>();

/** Google Fonts family names are plain words/spaces; anything else (a CSS
 * `var(...)` reference, a font stack with commas, or empty) isn't a Google Font request. */
function isGoogleFontName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && !n.startsWith("var(") && !n.includes(",");
}

/** <style> elements this module added, so `removeGoogleFonts` can undo them on unload */
const styleEls: HTMLStyleElement[] = [];

export function ensureGoogleFont(name: string) {
  const n = name.trim();
  if (!isGoogleFontName(n) || loadedFonts.has(n)) return;
  loadedFonts.add(n);
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(n).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  void requestUrl({ url })
    .then((res) => {
      const style = document.head.createEl("style", { cls: "mgn-google-font" });
      style.setText(res.text);
      styleEls.push(style);
    })
    .catch(() => {
      // offline or unknown family: the font stack falls back to sans-serif
      loadedFonts.delete(n); // allow a retry on the next render
    });
}

export function removeGoogleFonts() {
  for (const el of styleEls) el.remove();
  styleEls.length = 0;
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
