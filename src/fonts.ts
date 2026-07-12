/** Loads a Google Font by family name via a stylesheet <link>, once per name. */

const loadedFonts = new Set<string>();

/** Google Fonts family names are plain words/spaces; anything else (a CSS
 * `var(...)` reference, a font stack with commas, or empty) isn't a Google Font request. */
function isGoogleFontName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && !n.startsWith("var(") && !n.includes(",");
}

export function ensureGoogleFont(name: string) {
  const n = name.trim();
  if (!isGoogleFontName(n) || loadedFonts.has(n)) return;
  loadedFonts.add(n);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(n).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

/** CSS `font-family` value for a settings font field: quotes bare Google Font
 * names, passes through `var(...)`/font-stack values and "" as-is. */
export function fontFamilyValue(name: string): string {
  const n = name.trim();
  if (!n) return "inherit";
  if (n.startsWith("var(") || n.includes(",")) return n;
  return `"${n}", sans-serif`;
}
