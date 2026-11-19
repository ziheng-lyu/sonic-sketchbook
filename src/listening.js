import { SOUND_RADIUS } from './geometry.js';

// Gain follows position only. Sound starts once per visit; no looping or retrigger
// happens when the pointer pauses within a field.
export function proximityGain(distance, radius = SOUND_RADIUS) {
  const amount = Math.max(0, Math.min(1, 1 - distance / radius));
  return amount * amount * (3 - 2 * amount);
}

function interval(a, b, center) {
  const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - center.x, fy = a.y - center.y;
  const length = dx * dx + dy * dy;
  if (!length) return fx * fx + fy * fy < SOUND_RADIUS ** 2 ? [0, 1] : null;
  const along = -(fx * dx + fy * dy) / length;
  const discriminant = SOUND_RADIUS ** 2 - ((fx + along * dx) ** 2 + (fy + along * dy) ** 2);
  if (discriminant <= 1e-9) return null;
  const half = Math.sqrt(discriminant / length);
  const enter = Math.max(0, along - half), exit = Math.min(1, along + half);
  return exit - enter > 1e-10 ? [enter, exit, along] : null;
}

export class ListeningGesture {
  constructor(sounds, size) {
    this.sounds = sounds.map(sound => ({ id: sound.id, x: sound.x * size.width, y: sound.y * size.height }));
    this.size = size; this.events = []; this.active = new Map();
  }
  advance(a, b) {
    const from = { x: a.x * this.size.width, y: a.y * this.size.height };
    const to = { x: b.x * this.size.width, y: b.y * this.size.height };
    const dx = to.x - from.x, dy = to.y - from.y;
    const updates = [];
    for (const sound of this.sounds) {
      const range = interval(from, to, sound);
      if (!range) continue;
      const [enter, exit, nearest] = range;
      let event = this.active.get(sound.id);
      const fresh = !event;
      if (fresh) {
        event = { soundId: sound.id, at: a.t + (b.t - a.t) * enter, envelope: [] };
        this.events.push(event); this.active.set(sound.id, event);
      }
      // Sampling each few pixels also catches the peak in an outside-to-outside
      // crossing even if no pointer sample landed within the area.
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * (exit - enter) / 4));
      const fractions = Array.from({ length: steps + 1 }, (_, i) => enter + (exit - enter) * i / steps);
      if (nearest > enter && nearest < exit) fractions.push(nearest);
      fractions.sort((a, b) => a - b);
      const points = [];
      for (const fraction of fractions) {
        const at = Math.max(0, a.t + (b.t - a.t) * fraction - event.at);
        const gain = proximityGain(Math.hypot(from.x + dx * fraction - sound.x, from.y + dy * fraction - sound.y));
        const point = { at, gain };
        const previous = event.envelope.at(-1);
        if (previous?.at === at && previous.gain === gain) continue;
        event.envelope.push(point); points.push(point);
      }
      const closed = Math.hypot(to.x - sound.x, to.y - sound.y) >= SOUND_RADIUS - 1e-8;
      if (closed) {
        const last = event.envelope.at(-1);
        // Avoid tiny floating point residuals at the field boundary.
        last.gain = 0;
        if (!points.includes(last)) points.push(last);
        this.active.delete(sound.id);
      }
      if (points.length || fresh) updates.push({ event, fresh, points, closed });
    }
    // Preserve spatial order when a fast segment crosses several fields.
    this.events.sort((a, b) => a.at - b.at);
    return updates.sort((a, b) => a.event.at - b.event.at);
  }
  finish(time) {
    const updates = [];
    for (const event of this.active.values()) {
      const last = event.envelope.at(-1);
      const points = [{ at: Math.max(last.at, time - event.at), gain: last.gain }, { at: Math.max(last.at, time - event.at) + 12, gain: 0 }];
      event.envelope.push(...points);
      updates.push({ event, fresh: false, points, closed: true });
    }
    this.active.clear();
    return updates;
  }
}
