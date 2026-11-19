// Only the latest position matters for moving a material. Drawing still keeps
// every sample separately for sound crossings and recorded timing.
export function frameDrag(apply, schedule = requestAnimationFrame, unschedule = cancelAnimationFrame) {
  let frame = null, latest = null, closed = false;
  const cancelFrame = () => { if (frame !== null) unschedule(frame); frame = null; };
  return {
    update(position) {
      if (closed) return;
      latest = position;
      if (frame === null) frame = schedule(() => { frame = null; if (!closed) apply(latest); });
    },
    finish(position = latest) {
      if (closed) return;
      cancelFrame(); if (position) apply(position); closed = true;
    },
    cancel() { cancelFrame(); closed = true; },
  };
}
