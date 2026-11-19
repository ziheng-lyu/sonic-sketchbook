import React, { useRef } from 'react';
import { MIN_SCALE, MAX_SCALE } from './shapes.js';

export function SizeControl({ value, onPreview, onCommit, onCancel }) {
  const pending = useRef(null);
  function finish() {
    if (pending.current === null) return;
    const next = pending.current; pending.current = null; onCommit(next);
  }
  return <div className="sound-size-control">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3" /></svg>
    <input type="range" aria-label="Sound size" min={MIN_SCALE} max={MAX_SCALE} step="0.05" value={value}
      aria-valuetext={`${Math.round(value * 100)}% size`}
      onChange={event => { pending.current = Number(event.target.value); onPreview(pending.current); }}
      onPointerUp={finish} onBlur={finish}
      onKeyDown={event => { if (event.key === 'Escape') { pending.current = null; onCancel(); } }}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) finish(); }}
      onPointerCancel={() => { pending.current = null; onCancel(); }} />
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>
  </div>;
}
