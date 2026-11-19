// A closed freehand outline uses the same even-odd interior for drawing,
// crossing detection and distance-controlled listening. No star-shape assumption.
const cache = new WeakMap();
export function insidePolygon(p, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function boundaryDistance(p, vertices) {
  let best = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}
function deepestPoint(vertices) {
  const xs = vertices.map(p => p.x), ys = vertices.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let best = null, depth = 0;
  const consider = p => {
    if (!insidePolygon(p, vertices)) return;
    const value = boundaryDistance(p, vertices);
    if (value > depth) { best = p; depth = value; }
  };
  const step = Math.max(maxX - minX, maxY - minY) / 28;
  if (!step) return { point: null, depth: 0 };
  consider({ x: 0, y: 0 });
  for (let y = minY + step / 2; y < maxY; y += step) for (let x = minX + step / 2; x < maxX; x += step) consider({ x, y });
  // Thin, valid regions can fall between grid samples. Probe inward from edges.
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    for (const sign of [-1, 1]) consider({ x: (a.x + b.x) / 2 - sign * (b.y - a.y) / length * step / 4, y: (a.y + b.y) / 2 + sign * (b.x - a.x) / length * step / 4 });
  }
  if (best) for (let stepSize = step / 2; stepSize > step / 64; stepSize /= 2) {
    const around = best;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) consider({ x: around.x + x * stepSize, y: around.y + y * stepSize });
  }
  return { point: best, depth };
}
export function customGeometry(outline) {
  if (!cache.has(outline)) cache.set(outline, { ...deepestPoint(outline), insets: new Map() });
  return cache.get(outline);
}
export function validOutline(outline) {
  return Array.isArray(outline) && outline.length >= 3 && outline.length <= 192
    && outline.every(p => p && typeof p.x === 'number' && Number.isFinite(p.x) && Math.abs(p.x) <= 1.001 && typeof p.y === 'number' && Number.isFinite(p.y) && Math.abs(p.y) <= 1.001)
    && customGeometry(outline).depth > 1e-5 && insidePolygon({ x: 0, y: 0 }, outline);
}
// Preserve the drawn silhouette and aspect ratio; place an interior listening
// anchor at the sound position, then fit its extent to the standard sound size.
export function makeOutline(points) {
  const clean = [];
  for (const p of points) if (!clean.length || Math.hypot(p.x - clean.at(-1).x, p.y - clean.at(-1).y) > .5) clean.push(p);
  if (clean.length < 3) return null;
  const xs = clean.map(p => p.x), ys = clean.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  if (width < 5 || height < 5) return null;
  const step = Math.max(1, Math.ceil(clean.length / 191));
  const sampled = clean.filter((_, i) => i % step === 0);
  if (sampled.at(-1) !== clean.at(-1)) sampled.push(clean.at(-1));
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const scale = Math.max(width, height) / 2;
  const fitted = sampled.map(p => ({ x: (p.x - middle.x) / scale, y: (p.y - middle.y) / scale }));
  const { point, depth } = deepestPoint(fitted);
  if (!point || depth < 1e-5) return null;
  const radius = Math.max(...fitted.map(p => Math.hypot(p.x - point.x, p.y - point.y)));
  const outline = fitted.map(p => ({ x: (p.x - point.x) / radius, y: (p.y - point.y) / radius }));
  return validOutline(outline) ? outline : null;
}
export function customDistance(point, outline, radius) {
  const p = { x: point.x / radius, y: point.y / radius };
  const distance = boundaryDistance(p, outline);
  return insidePolygon(p, outline) ? Math.max(0, 1 - distance / customGeometry(outline).depth) : 1 + distance;
}
// Static inward contours show increasing loudness without scaling a concave
// silhouette outside itself. Cache small raster contours as SVG run rectangles.
export function customInsetPath(outline, fraction, radius) {
  const geometry = customGeometry(outline);
  const key = `${fraction}:${radius}`;
  if (geometry.insets.has(key)) return geometry.insets.get(key);
  const count = 64, step = 2 / count, commands = [];
  for (let row = 0; row < count; row++) {
    let start = null;
    for (let column = 0; column <= count; column++) {
      const p = { x: -1 + (column + .5) * step, y: -1 + (row + .5) * step };
      const filled = column < count && insidePolygon(p, outline) && boundaryDistance(p, outline) >= geometry.depth * fraction;
      if (filled && start === null) start = column;
      if (!filled && start !== null) {
        const x = (-1 + start * step) * radius, y = (-1 + row * step) * radius, width = (column - start) * step * radius;
        commands.push(`M${x},${y}h${width}v${step * radius}h${-width}Z`); start = null;
      }
    }
  }
  const path = commands.join(''); geometry.insets.set(key, path); return path;
}
