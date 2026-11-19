import React, { useId, useRef, useState } from 'react';
import { SizeControl } from './SizeControl.jsx';
import { ShapeEditor } from './ShapeEditor.jsx';
import { customInsetPath, customGeometry } from './custom-shape.js';
import { SHAPES, shapePath, soundMode, soundShape, soundRadius, soundScale } from './shapes.js';

export function ShapeMark({ shape = 'circle', radius = 1, outline, ...props }) {
  return <path fillRule="evenodd" d={shapePath(shape, radius, outline)} {...props} />;
}
export function SoundMark({ sound }) {
  const shape = soundShape(sound), field = soundMode(sound) === 'proximity';
  const clip = useId(), scale = soundScale(sound);
  if (shape === 'custom') {
    const radius = soundRadius(sound);
    return field ? <>
      <defs><clipPath id={clip}><ShapeMark shape={shape} outline={sound.outline} radius={radius} clipRule="evenodd" /></clipPath></defs>
      <g clipPath={`url(#${clip})`}><path d={customInsetPath(sound.outline, .33, 1)} transform={`scale(${radius})`} className="sound-target" /></g>
      <ShapeMark shape={shape} outline={sound.outline} radius={radius} className="sound-field" />
      <g clipPath={`url(#${clip})`}><path d={customInsetPath(sound.outline, .33, 1)} transform={`scale(${radius})`} className="sound-inner" /></g>
      <circle r={Math.min(6 * scale, customGeometry(sound.outline).depth * radius * .45)} clipPath={`url(#${clip})`} className="sound-mark" />
    </> : <ShapeMark shape={shape} outline={sound.outline} radius={radius} className="sound-plain" />;
  }
  return field ? <>
    <circle r={10 * scale} className="sound-target" />
    <ShapeMark shape={shape} radius={18 * scale} className="sound-target" />
    <ShapeMark shape={shape} radius={soundRadius(sound)} className="sound-field" />
    <ShapeMark shape={shape} radius={23 * scale} className="sound-inner" />
    <ShapeMark shape={shape} radius={8 * scale} className="sound-mark" />
  </> : <><circle r={10 * scale} className="sound-target" /><ShapeMark shape={shape} radius={soundRadius(sound)} className="sound-plain" /></>;
}
export function SoundOptions({ sound, position, size, onChange, onSizePreview, onClose }) {
  const [editing, setEditing] = useState(false);
  const resizeAnchor = useRef(null);
  const height = editing ? 390 : 170;
  const left = Math.max(12, Math.min(size.width - 256, position.x * size.width - 122));
  const below = position.y * size.height + soundRadius(sound) + 12;
  const top = Math.max(12, Math.min(size.height - height - 90, below + height < size.height - 90 ? below : position.y * size.height - soundRadius(sound) - height - 12));
  return <section className="sound-options" role="dialog" aria-label="Sound options" style={resizeAnchor.current || { left, top }}>
    <div className="sound-mode-options" role="group" aria-label="Playback mode">
      <button aria-label="Whole sound playback" aria-pressed={soundMode(sound) === 'trigger'} onClick={() => onChange({ mode: 'trigger' })}>
        <svg viewBox="-16 -16 32 32" aria-hidden="true"><circle r="10" className="mode-plain" /></svg>
      </button>
      <button aria-label="Proximity playback" aria-pressed={soundMode(sound) === 'proximity'} onClick={() => onChange({ mode: 'proximity' })}>
        <svg viewBox="-16 -16 32 32" aria-hidden="true"><circle r="14" className="sound-field" /><circle r="9" className="sound-inner" /><circle r="4" className="sound-mark" /></svg>
      </button>
      <button aria-label="Draw a custom shape" aria-pressed={editing || soundShape(sound) === 'custom'} onClick={() => setEditing(!editing)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" /></svg>
      </button>
      <button className="sound-options-close" aria-label="Close sound options" onClick={onClose}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>
    <div className="sound-shape-options" role="group" aria-label="Sound shape">
      {SHAPES.map(shape => <button key={shape} aria-label={`${shape[0].toUpperCase() + shape.slice(1)} shape`} aria-pressed={soundShape(sound) === shape} onClick={() => onChange({ shape })}>
        <svg viewBox="-14 -14 28 28" aria-hidden="true"><ShapeMark shape={shape} radius={10} className="mode-plain" /></svg>
      </button>)}
    </div>
    <SizeControl value={soundScale(sound)}
      onPreview={value => { if (!resizeAnchor.current) resizeAnchor.current = { left, top }; onSizePreview(value); }}
      onCommit={value => { resizeAnchor.current = null; onChange({ scale: value }); }}
      onCancel={() => { resizeAnchor.current = null; onSizePreview(null); }} />
    {editing && <ShapeEditor key={sound.id} outline={sound.outline} onApply={outline => { onChange({ shape: 'custom', outline }); setEditing(false); }} />}
  </section>;
}
