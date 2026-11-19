import { FIELD_RADIUS, soundMode, soundShape, soundRadius, shapeDistance, shapeIntervals } from './shapes.js';

export function proximityGain(distance, radius = FIELD_RADIUS) {
  const amount = Math.max(0, Math.min(1, 1 - distance / radius));
  return amount * amount * (3 - 2 * amount);
}

export class ListeningGesture {
  constructor(sounds, size) {
    this.sounds = sounds.map(sound => ({ ...sound, x: sound.x * size.width, y: sound.y * size.height }));
    this.size = size; this.events = []; this.active = new Map();
  }
  advance(a, b) {
    const updates = [];
    for (const sound of this.sounds) {
      const from = { x: a.x * this.size.width - sound.x, y: a.y * this.size.height - sound.y };
      const to = { x: b.x * this.size.width - sound.x, y: b.y * this.size.height - sound.y };
      const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
      const shape = soundShape(sound), radius = soundRadius(sound), field = soundMode(sound) === 'proximity';
      const ranges = shapeIntervals(from, to, shape, radius, sound.outline);
      for (const [enter, exit] of ranges) {
        let event = this.active.get(sound.id);
        const fresh = !event;
        if (fresh) {
          event = { soundId: sound.id, at: a.t + (b.t - a.t) * enter, ...(field ? { envelope: [] } : {}) };
          this.events.push(event); this.active.set(sound.id, event);
        }
        const closed = exit < 1 - 1e-9 || shapeDistance(to, shape, radius, sound.outline) >= 1 - 1e-9;
        const points = [];
        if (field) {
          const steps = Math.max(1, Math.ceil(Math.sqrt(length) * (exit - enter) / 3));
          const fractions = Array.from({ length: steps + 1 }, (_, i) => enter + (exit - enter) * i / steps);
          const nearest = length ? -(from.x * dx + from.y * dy) / length : 0;
          if (nearest > enter && nearest < exit) fractions.push(nearest);
          fractions.sort((a, b) => a - b);
          for (const fraction of fractions) {
            const at = Math.max(0, a.t + (b.t - a.t) * fraction - event.at);
            const gain = proximityGain(shapeDistance({ x: from.x + dx * fraction, y: from.y + dy * fraction }, shape, radius, sound.outline), 1);
            const previous = event.envelope.at(-1);
            if (previous?.at === at && previous.gain === gain) continue;
            const point = { at, gain }; event.envelope.push(point); points.push(point);
          }
          if (closed) {
            const last = event.envelope.at(-1); last.gain = 0;
            if (!points.includes(last)) points.push(last);
          }
        }
        if (closed) this.active.delete(sound.id);
        if (field ? points.length || fresh : fresh) updates.push({ event, fresh, points, closed });
      }
    }
    this.events.sort((a, b) => a.at - b.at);
    return updates.sort((a, b) => a.event.at - b.event.at);
  }
  finish(time) {
    const updates = [];
    for (const event of this.active.values()) {
      if (!event.envelope) continue;
      const last = event.envelope.at(-1);
      const points = [{ at: Math.max(last.at, time - event.at), gain: last.gain }, { at: Math.max(last.at, time - event.at) + 12, gain: 0 }];
      event.envelope.push(...points); updates.push({ event, fresh: false, points, closed: true });
    }
    this.active.clear(); return updates;
  }
}
