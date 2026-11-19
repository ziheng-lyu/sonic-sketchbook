import React from 'react';
import { SHAPES, shapePath, soundMode, soundShape, soundRadius } from './shapes.js';

export function ShapeMark({ shape = 'circle', radius = 1, ...props }) {
  return <path d={shapePath(shape, radius)} {...props} />;
}
export function SoundMark({ sound }) {
  const shape = soundShape(sound), field = soundMode(sound) === 'proximity';
  return field ? <>
    <circle r="10" className="sound-target" />
    <ShapeMark shape={shape} radius={18} className="sound-target" />
    <ShapeMark shape={shape} radius={soundRadius(sound)} className="sound-field" />
    <ShapeMark shape={shape} radius="23" className="sound-inner" />
    <ShapeMark shape={shape} radius="8" className="sound-mark" />
  </> : <><circle r="10" className="sound-target" /><ShapeMark shape={shape} radius={soundRadius(sound)} className="sound-plain" /></>;
}
export function SoundOptions({ sound, position, size, onChange, onClose }) {
  const left = Math.max(12, Math.min(size.width - 256, position.x * size.width - 122));
  const below = position.y * size.height + soundRadius(sound) + 12;
  const top = Math.max(12, Math.min(size.height - 142, below + 130 < size.height - 12 ? below : position.y * size.height - soundRadius(sound) - 142));
  return <section className="sound-options" role="dialog" aria-label="Sound options" style={{ left, top }}>
    <div className="sound-mode-options" role="group" aria-label="Playback mode">
      <button aria-label="Whole sound playback" aria-pressed={soundMode(sound) === 'trigger'} onClick={() => onChange({ mode: 'trigger' })}>
        <svg viewBox="-16 -16 32 32" aria-hidden="true"><circle r="10" className="mode-plain" /></svg>
      </button>
      <button aria-label="Proximity playback" aria-pressed={soundMode(sound) === 'proximity'} onClick={() => onChange({ mode: 'proximity' })}>
        <svg viewBox="-16 -16 32 32" aria-hidden="true"><circle r="14" className="sound-field" /><circle r="9" className="sound-inner" /><circle r="4" className="sound-mark" /></svg>
      </button>
      <button className="sound-options-close" aria-label="Close sound options" onClick={onClose}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>
    <div className="sound-shape-options" role="group" aria-label="Sound shape">
      {SHAPES.map(shape => <button key={shape} aria-label={`${shape[0].toUpperCase() + shape.slice(1)} shape`} aria-pressed={soundShape(sound) === shape} onClick={() => onChange({ shape })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><ShapeMark shape={shape} radius={10} className="mode-plain" /></svg>
      </button>)}
    </div>
  </section>;
}
