export const TRIGGER_RADIUS = 22;
export const FIELD_RADIUS = 34;
export const SHAPES = ['circle', 'square', 'triangle', 'star', 'organic'];
export const MODES = ['trigger', 'proximity'];
export const soundShape = sound => sound.shape || 'circle';
export const soundMode = sound => sound.mode || 'trigger';
export const soundRadius = sound => soundMode(sound) === 'proximity' ? FIELD_RADIUS : TRIGGER_RADIUS;

const polar = (angle, radius = 1) => ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
const polygons = {
  square: [{ x: -.82, y: -.82 }, { x: .82, y: -.82 }, { x: .82, y: .82 }, { x: -.82, y: .82 }],
  triangle: Array.from({ length: 3 }, (_, i) => polar(-Math.PI / 2 + i * Math.PI * 2 / 3)),
  star: Array.from({ length: 10 }, (_, i) => polar(-Math.PI / 2 + i * Math.PI / 5, i % 2 ? .48 : 1)),
  organic: Array.from({ length: 72 }, (_, i) => {
    const angle = i * Math.PI * 2 / 72;
    return polar(angle, .84 + .1 * Math.sin(3 * angle + .4) + .06 * Math.cos(5 * angle));
  }),
};
export function shapePath(shape, radius = 1) {
  if (shape === 'circle') return `M${-radius},0a${radius},${radius} 0 1,0 ${2 * radius},0a${radius},${radius} 0 1,0 ${-2 * radius},0Z`;
  return polygons[shape].map((p, i) => `${i ? 'L' : 'M'}${p.x * radius},${p.y * radius}`).join('') + 'Z';
}
const cross = (a, b) => a.x * b.y - a.y * b.x;

// All offered shapes are star-shaped about their center. The radial boundary
// therefore gives a continuous, shape-aware measure of proximity.
export function shapeDistance(point, shape, radius) {
  const length = Math.hypot(point.x, point.y);
  if (!length) return 0;
  if (shape === 'circle') return length / radius;
  const direction = { x: point.x / length, y: point.y / length };
  let boundary = Infinity;
  const vertices = polygons[shape];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const edge = { x: b.x - a.x, y: b.y - a.y }, denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-12) continue;
    const distance = cross(a, edge) / denominator, position = cross(a, direction) / denominator;
    if (distance >= 0 && position >= -1e-9 && position <= 1 + 1e-9) boundary = Math.min(boundary, distance);
  }
  return length / (boundary * radius);
}

// Return every interior interval of a segment, including separate star arms.
// This uses the same vertices as rendering, so invisible bounding circles never
// trigger sounds in a square corner or a star's empty notch.
export function shapeIntervals(a, b, shape, radius) {
  const delta = { x: b.x - a.x, y: b.y - a.y }, length = delta.x ** 2 + delta.y ** 2;
  if (!length) return shapeDistance(a, shape, radius) < 1 - 1e-9 ? [[0, 1]] : [];
  const closest = Math.max(0, Math.min(1, -(a.x * delta.x + a.y * delta.y) / length));
  if (Math.hypot(a.x + closest * delta.x, a.y + closest * delta.y) > radius * 1.17) return [];
  if (shape === 'circle') {
    const along = -(a.x * delta.x + a.y * delta.y) / length;
    const discriminant = radius ** 2 - ((a.x + along * delta.x) ** 2 + (a.y + along * delta.y) ** 2);
    if (discriminant <= 1e-9) return [];
    const half = Math.sqrt(discriminant / length), enter = Math.max(0, along - half), exit = Math.min(1, along + half);
    return exit - enter > 1e-10 ? [[enter, exit]] : [];
  }
  const cuts = [0, 1], vertices = polygons[shape].map(p => ({ x: p.x * radius, y: p.y * radius }));
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    const edge = { x: q.x - p.x, y: q.y - p.y }, rel = { x: p.x - a.x, y: p.y - a.y };
    const denominator = cross(delta, edge);
    if (Math.abs(denominator) < 1e-12) continue;
    const at = cross(rel, edge) / denominator, side = cross(rel, delta) / denominator;
    if (at > 0 && at < 1 && side >= -1e-9 && side <= 1 + 1e-9) cuts.push(at);
  }
  cuts.sort((a, b) => a - b);
  const ranges = [];
  for (let i = 1; i < cuts.length; i++) {
    const enter = cuts[i - 1], exit = cuts[i], middle = (enter + exit) / 2;
    if (exit - enter < 1e-10 || shapeDistance({ x: a.x + delta.x * middle, y: a.y + delta.y * middle }, shape, radius) >= 1 - 1e-9) continue;
    if (ranges.at(-1) && Math.abs(ranges.at(-1)[1] - enter) < 1e-9) ranges.at(-1)[1] = exit;
    else ranges.push([enter, exit]);
  }
  return ranges;
}
