/** true if segment (x0,y0)-(x1,y1) touches or crosses axis-aligned rect [xmin,xmax]x[ymin,ymax] (Liang-Barsky clip test) */
export function segmentIntersectsRect(
  x0: number, y0: number, x1: number, y1: number,
  xmin: number, ymin: number, xmax: number, ymax: number
): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallel to this edge and outside it
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
