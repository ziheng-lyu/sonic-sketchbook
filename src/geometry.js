import { FIELD_RADIUS, TRIGGER_RADIUS, shapeIntervals, soundShape, soundRadius } from './shapes.js';
export const SOUND_RADIUS = FIELD_RADIUS;
function defaultSoundPosition(index, size) {
  const gap = Math.min(72, Math.max(0, (size.width - 80) / 4));
  return keepOnCanvas({
    x: (size.width - 40 - (4 - index) * gap) / size.width,
    y: Math.min(size.height / 2, size.width <= 600 ? 104 : 44) / size.height,
  }, size);
}

export const initialSounds = Array.from({ length: 5 }, (_, index) => ({
  id: `seed-${index}`,
  ...defaultSoundPosition(index, { width: 1280, height: 720 }),
  parked: true,
}));

export function soundPosition(sound, size) {
  const index = sound.parked === true && /^seed-[0-4]$/.test(sound.id)
    ? Number(sound.id.slice(-1)) : null;
  const position = index === null ? sound : defaultSoundPosition(index, size);
  return keepOnCanvas(position, size, soundPadding(sound));
}

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Return the first entry along the whole segment, including fast crossings
// whose pointer samples both fall outside the circle.
export function circleEntry(a, b, center, radius = TRIGGER_RADIUS) {
  const fx = a.x - center.x, fy = a.y - center.y;
  if (fx * fx + fy * fy <= radius * radius + 1e-8) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const aa = dx * dx + dy * dy;
  if (aa < 1e-12) return null;
  const bb = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - radius * radius;
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < 0) return null;
  const t = (-bb - Math.sqrt(discriminant)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

export function crossings(a, b, sounds, size) {
  const from = { x: a.x * size.width, y: a.y * size.height };
  const to = { x: b.x * size.width, y: b.y * size.height };
  return sounds.flatMap(sound => {
    const center = { x: sound.x * size.width, y: sound.y * size.height };
    return shapeIntervals({ x: from.x - center.x, y: from.y - center.y }, { x: to.x - center.x, y: to.y - center.y }, soundShape(sound), soundRadius(sound), sound.outline)
      .filter(([enter]) => enter > 0)
      .map(([enter]) => ({ soundId: sound.id, at: a.t + (b.t - a.t) * enter, fraction: enter }));
  }).sort((left, right) => left.fraction - right.fraction);
}

export function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function nearestPath(point, paths, size, tolerance = 9) {
  let best = null, closest = tolerance;
  for (const path of [...paths].reverse()) {
    for (let index = 1; index < path.points.length; index++) {
      const a = path.points[index - 1], b = path.points[index];
      const d = segmentDistance(point, { x: a.x * size.width, y: a.y * size.height }, { x: b.x * size.width, y: b.y * size.height });
      if (d < closest) { closest = d; best = path.id; }
    }
  }
  return best;
}

// Keep the grab point reachable while large listening areas can extend off-canvas.
export const soundPadding = () => 40;

export function keepOnCanvas(point, size, padding = 40) {
  const mx = Math.min(.5, padding / size.width), my = Math.min(.5, padding / size.height);
  return { x: Math.max(mx, Math.min(1 - mx, point.x)), y: Math.max(my, Math.min(1 - my, point.y)) };
}
