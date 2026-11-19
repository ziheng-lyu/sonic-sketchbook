import React, { useRef, useState } from 'react';
import { makeOutline } from './custom-shape.js';
import { shapePath } from './shapes.js';

export function ShapeEditor({ outline, onApply }) {
  const [result, setResult] = useState(outline || null), [stroke, setStroke] = useState(null);
  const drawing = useRef(null);
  const location = (event, svg) => {
    const rect = svg.getBoundingClientRect();
    return { x: Math.max(-100, Math.min(100, (event.clientX - rect.left) / rect.width * 200 - 100)), y: Math.max(-80, Math.min(80, (event.clientY - rect.top) / rect.height * 160 - 80)) };
  };
  function sample(event) {
    const active = drawing.current;
    if (!active || active.id !== event.pointerId) return;
    const events = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const item of events.length ? events : [event]) active.points.push(location(item, event.currentTarget));
    // Bound edit-time sampling too; very long strokes must stay responsive.
    if (active.points.length > 2048) active.points = active.points.filter((_, i) => i % 2 === 0);
    setStroke([...active.points]);
  }
  return <div className="shape-editor">
    <svg className="shape-drawing-pad" viewBox="-100 -80 200 160" role="group" aria-label="Draw custom shape" tabIndex="0"
      onPointerDown={event => {
        if (event.button !== 0 || drawing.current) return;
        event.preventDefault(); event.currentTarget.focus();
        drawing.current = { id: event.pointerId, points: [location(event, event.currentTarget)] };
        setStroke([...drawing.current.points]); setResult(null); event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={sample}
      onPointerUp={event => {
        if (!drawing.current || drawing.current.id !== event.pointerId) return;
        sample(event); const points = drawing.current.points; drawing.current = null;
        setResult(makeOutline(points)); setStroke(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drawing.current = null; setStroke(null); }}
      onLostPointerCapture={() => { if (drawing.current) { drawing.current = null; setStroke(null); } }}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); setResult(null); setStroke(null); drawing.current = null; }
        if (event.key === 'Enter' && result) { event.preventDefault(); onApply(result); }
      }}>
      {stroke && <polyline className="custom-outline-stroke" points={stroke.map(p => `${p.x},${p.y}`).join(' ')} />}
      {!stroke && result && <path className="custom-outline-preview" fillRule="evenodd" d={shapePath('custom', 65, result)} />}
    </svg>
    <div className="shape-editor-actions">
      <button aria-label="Redraw custom shape" onClick={() => { setResult(null); setStroke(null); drawing.current = null; }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 5-5 5 5 5M3 10h10a7 7 0 0 1 7 7v2" /></svg>
      </button>
      <button aria-label="Apply custom shape" disabled={!result || !!stroke} onClick={() => onApply(result)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
      </button>
    </div>
  </div>;
}
