export const SOUND_RADIUS = 16;
export const initialSounds = [
  { id: 'seed-0', x: .25, y: .31 },
  { id: 'seed-1', x: .63, y: .23 },
  { id: 'seed-2', x: .46, y: .49 },
  { id: 'seed-3', x: .75, y: .62 },
  { id: 'seed-4', x: .28, y: .72 },
];

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Return the first entry along the whole segment, including fast crossings
// whose pointer samples both fall outside the circle.
export function circleEntry(a, b, center, radius = SOUND_RADIUS) {
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
    const t = circleEntry(from, to, { x: sound.x * size.width, y: sound.y * size.height });
    return t === null ? [] : [{ soundId: sound.id, at: a.t + (b.t - a.t) * t, fraction: t }];
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

export function keepOnCanvas(point, size) {
  const mx = Math.min(.5, 24 / size.width), my = Math.min(.5, 24 / size.height);
  return { x: Math.max(mx, Math.min(1 - mx, point.x)), y: Math.max(my, Math.min(1 - my, point.y)) };
}
