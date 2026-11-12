import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEngine } from './audio.js';
import { Microphone } from './recorder.js';
import { crossings, keepOnCanvas, nearestPath, SOUND_RADIUS } from './geometry.js';
import { initialState, reducer } from './model.js';
import { loadSketch, saveSketch } from './share.js';
import './style.css';

function Icon({ name }) {
  const icons = {
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v4m-3 0h6"/></>,
    undo: <><path d="m8 5-5 5 5 5"/><path d="M3 10h10a7 7 0 0 1 7 7v2"/></>,
    play: <path d="m9 5 10 7-10 7Z"/>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
    share: <><path d="m10 13 4-4"/><path d="M8 16H6a4 4 0 0 1-3-7l4-4a4 4 0 0 1 6 0M16 8h2a4 4 0 0 1 3 7l-4 4a4 4 0 0 1-6 0"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>,
    check: <path d="m5 12 4 4 10-10"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [draft, setDraft] = useState(null);
  const [moving, setMoving] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState('idle');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(window.location.hash.startsWith('#s='));
  const [saving, setSaving] = useState(false);
  const [shareURL, setShareURL] = useState('');
  const [copied, setCopied] = useState(false);
  const restoring = useRef(loading), lastSaved = useRef(null), shareInput = useRef(null);
  const svg = useRef(null), fileInput = useRef(null), gesture = useRef(null);
  const engine = useRef(null), microphone = useRef(null), playTimer = useRef(null);
  const playbackEpoch = useRef(0), mounted = useRef(true), current = useRef(state);
  current.current = state;
  const viewSounds = state.sounds.map(sound => ({ ...sound, ...keepOnCanvas(sound, size) }));
  if (!engine.current) engine.current = new AudioEngine();

  function report(message) { if (mounted.current) setError(message); }
  function unlock() { engine.current.unlock().catch(() => report('Audio could not start. Try again.')); }
  function audition(id) { engine.current.audition(id).catch(() => report('Audio could not start. Try again.')); }
  function stopPlayback() {
    playbackEpoch.current++;
    clearTimeout(playTimer.current);
    playTimer.current = null;
    engine.current.stop();
    setPlaying(false);
  }
  function undo() {
    if (restoring.current) return;
    gesture.current = null; setDraft(null); setMoving(null);
    stopPlayback(); dispatch({ type: 'undo' });
  }

  function shareError(failure) {
    const message = failure?.message || '';
    return /^(This |An audio |The sketch |Please |Saving )/.test(message)
      ? message : 'The sketch could not be saved or opened. Please try again.';
  }
  async function copyLink(url = shareURL) {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setCopied(false); shareInput.current?.focus(); shareInput.current?.select(); }
  }
  async function save() {
    if (saving || restoring.current || recording !== 'idle' || importing || gesture.current) return;
    setSaving(true); setError(''); setCopied(false);
    const snapshot = current.current;
    try {
      const url = lastSaved.current?.state === snapshot ? lastSaved.current.url
        : await saveSketch(snapshot, engine.current.sources);
      if (!mounted.current) return;
      lastSaved.current = { state: snapshot, url };
      setShareURL(url);
      window.history.replaceState(null, '', url);
      await copyLink(url);
    } catch (failure) { report(shareError(failure)); }
    finally { if (mounted.current) setSaving(false); }
  }

  useEffect(() => {
    let active = true, epoch = 0;
    async function restore() {
      const hash = window.location.hash;
      const version = ++epoch;
      if (!hash.startsWith('#s=')) { restoring.current = false; setLoading(false); return; }
      restoring.current = true; setLoading(true); setError(''); setShareURL('');
      gesture.current = null; setDraft(null); setMoving(null); stopPlayback();
      try {
        const saved = await loadSketch(hash);
        if (!active || version !== epoch) return;
        await engine.current.restoreSources(saved.sources, () => active && version === epoch);
        if (!active || version !== epoch) return;
        dispatch({ type: 'restore', state: saved.state });
        lastSaved.current = { state: saved.state, url: window.location.href };
      } catch (failure) { if (active && version === epoch) report(shareError(failure)); }
      finally {
        if (active && version === epoch) { restoring.current = false; setLoading(false); }
      }
    }
    restore();
    window.addEventListener('hashchange', restore);
    return () => { active = false; epoch++; window.removeEventListener('hashchange', restore); };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      gesture.current = null;
      setDraft(null); setMoving(null);
      setSize({ width: Math.max(1, width), height: Math.max(1, height) });
    });
    observer.observe(svg.current);
    const onKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault(); undo();
      }
      if (event.key === 'Escape') {
        gesture.current = null; setDraft(null); setMoving(null); stopPlayback(); setError(''); setShareURL('');
      }
      if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); playSelected(); }
    };
    const onVisibility = () => {
      if (document.hidden) { stopPlayback(); gesture.current = null; setDraft(null); setMoving(null); }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      observer.disconnect(); window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(playTimer.current); engine.current.dispose(); microphone.current?.dispose();
    };
  }, []);

  function point(event, started = event.timeStamp) {
    const rect = svg.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)), t: Math.max(0, event.timeStamp - started) };
  }
  function pointerDown(event) {
    if (event.button !== 0 || gesture.current || restoring.current) return;
    setShareURL('');
    event.preventDefault();
    stopPlayback(); unlock();
    const p = point(event);
    const id = event.target.closest('[data-sound]')?.dataset.sound;
    const sound = viewSounds.find(item => item.id === id);
    const base = { pointerId: event.pointerId, started: event.timeStamp, start: p, moved: false, size: { ...size } };
    gesture.current = sound
      ? { ...base, type: 'move', sound, position: { x: sound.x, y: sound.y } }
      : { ...base, type: 'draw', points: [p], events: [], sounds: viewSounds };
    svg.current.setPointerCapture(event.pointerId);
    if (sound) setMoving({ id: sound.id, x: sound.x, y: sound.y });
  }
  function sample(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    const p = point(event, g.started);
    const travel = Math.hypot((p.x - g.start.x) * g.size.width, (p.y - g.start.y) * g.size.height);
    if (travel > 3) g.moved = true;
    if (g.type === 'move') {
      if (!g.moved) return;
      g.position = keepOnCanvas({ x: g.sound.x + p.x - g.start.x, y: g.sound.y + p.y - g.start.y }, g.size);
      setMoving({ id: g.sound.id, ...g.position });
    } else {
      const previous = g.points.at(-1);
      if (p.x === previous.x && p.y === previous.y && p.t === previous.t) return;
      const entered = crossings(previous, p, g.sounds, g.size);
      g.events.push(...entered.map(({ soundId, at }) => ({ soundId, at })));
      entered.forEach(entry => audition(entry.soundId));
      g.points.push(p);
      if (g.moved) setDraft([...g.points]);
    }
  }
  function pointerMove(event) {
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    if (samples.length) samples.forEach(sample);
    else sample(event);
  }
  function pointerUp(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    sample(event);
    gesture.current = null; setDraft(null); setMoving(null);
    if (svg.current.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    if (g.type === 'move') {
      if (g.moved) dispatch({ type: 'move', id: g.sound.id, position: g.position });
      else audition(g.sound.id);
    } else if (g.moved) {
      dispatch({ type: 'path', path: { id: crypto.randomUUID(), points: g.points, events: g.events, duration: Math.max(0, event.timeStamp - g.started) } });
    } else {
      const hit = nearestPath({ x: g.start.x * size.width, y: g.start.y * size.height }, state.paths, size);
      if (hit) dispatch({ type: 'select', id: hit });
    }
  }
  function cancelPointer(event) {
    if (gesture.current?.pointerId === event.pointerId) { gesture.current = null; setDraft(null); setMoving(null); }
  }

  async function playSelected() {
    if (restoring.current) return;
    if (playTimer.current) { stopPlayback(); playTimer.current = null; return; }
    const path = current.current.paths.find(item => item.id === current.current.selected);
    if (!path) return;
    stopPlayback();
    const epoch = playbackEpoch.current;
    try {
      await engine.current.unlock();
      if (epoch !== playbackEpoch.current || !mounted.current) return;
      setPlaying(true);
      const duration = engine.current.replay(path);
      playTimer.current = setTimeout(() => { playTimer.current = null; setPlaying(false); }, duration);
    } catch { report('Audio could not start. Try again.'); }
  }

  function placement(index, sounds) {
    // Prefer open space; identical circles reveal no attributes of their sounds.
    const candidates = Array.from({ length: 40 }, (_, n) => ({
      x: .15 + ((n * .61803398875 + index * .27) % 1) * .7,
      y: .14 + ((n * .41421356237 + index * .19) % 1) * .65,
    }));
    return candidates.reduce((best, p) => {
      const clearance = q => Math.min(...sounds.map(sound => Math.hypot((sound.x - q.x) * size.width, (sound.y - q.y) * size.height)));
      return clearance(p) > clearance(best) ? p : best;
    }, candidates[0]);
  }
  async function addFiles(files) {
    if (!files.length || restoring.current) return;
    setImporting(true); setError(''); stopPlayback();
    const added = [];
    let failed = 0;
    for (const file of files) {
      try {
        const id = crypto.randomUUID();
        await engine.current.import(id, await file.arrayBuffer());
        added.push({ id, ...placement(current.current.sounds.length + added.length, [...current.current.sounds, ...added]) });
      } catch { failed++; }
    }
    if (!mounted.current) return;
    if (added.length) dispatch({ type: 'add', sounds: added });
    if (failed) report('This audio could not be opened. Try another file.');
    setImporting(false);
  }

  async function finishRecording() {
    setRecording('saving');
    try {
      const blob = await microphone.current.finish();
      if (blob?.size) await addFiles([blob]);
      else report('No audio was captured. Try recording again.');
    } catch { report('The recording could not be saved. Try again.'); }
    finally { if (mounted.current) setRecording('idle'); }
  }
  async function record() {
    if (recording === 'recording') { await finishRecording(); return; }
    if (recording !== 'idle') return;
    stopPlayback(); setError(''); setRecording('requesting');
    const mic = new Microphone(navigator.mediaDevices, window.MediaRecorder);
    microphone.current = mic;
    try {
      await mic.start(() => { if (mounted.current) finishRecording(); });
      if (mounted.current) setRecording('recording');
    } catch (failure) {
      mic.release();
      report(failure.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser to record.' : 'The microphone is unavailable. Check your browser and device permissions.');
      if (mounted.current) setRecording('idle');
    }
  }

  const line = points => points.map(p => `${p.x * size.width},${p.y * size.height}`).join(' ');
  const busy = loading || recording === 'requesting' || recording === 'saving' || importing;
  return <main className="sketchbook" aria-busy={loading || saving} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}>
    <svg ref={svg} className={`canvas${moving ? ' moving' : ''}`} aria-label="Sound sketchbook" role="group"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}>
      {state.paths.map((path, index) => <polyline key={path.id} points={line(path.points)}
        className={`path${path.id === state.selected && !draft ? ' selected' : ''}`}
        style={{ '--age-opacity': Math.max(.3, .55 + .3 * index / Math.max(1, state.paths.length - 1)) }}
        role="button" tabIndex="0" aria-label={`Select path ${index + 1}`} aria-pressed={path.id === state.selected}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dispatch({ type: 'select', id: path.id }); } }} />)}
      {draft && <polyline points={line(draft)} className="path selected draft" />}
      {viewSounds.map((sound, index) => {
        const position = moving?.id === sound.id ? moving : sound;
        return <g key={sound.id} data-sound={sound.id} className="sound" transform={`translate(${position.x * size.width} ${position.y * size.height})`}
          role="button" tabIndex="0" aria-label={`Play sound ${index + 1}`}
          onKeyDown={event => {
            if (restoring.current) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); audition(sound.id); }
            const steps = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
            if (steps[event.key]) {
              event.preventDefault(); stopPlayback();
              const [x, y] = steps[event.key];
              dispatch({ type: 'move', id: sound.id, position: keepOnCanvas({ x: sound.x + x / size.width, y: sound.y + y / size.height }, size) });
            }
          }}>
          <circle r="22" className="sound-target" />
          <circle r={SOUND_RADIUS} className="sound-mark" />
        </g>;
      })}
    </svg>
    <div className="controls" role="toolbar" aria-label="Sketchbook controls">
      <button aria-label="Upload audio" disabled={busy} onClick={() => fileInput.current.click()}><Icon name="upload" /></button>
      <button aria-label={recording === 'recording' ? 'Finish recording' : recording === 'requesting' ? 'Waiting for microphone permission' : 'Record sound'}
        className={recording === 'recording' ? 'recording' : ''} disabled={busy} onClick={record} aria-pressed={recording === 'recording'}>
        <Icon name={recording === 'recording' ? 'stop' : 'mic'} />
      </button>
      <span className="divider" aria-hidden="true" />
      <button aria-label="Undo" disabled={loading || !state.history.length} onClick={undo}><Icon name="undo" /></button>
      <button aria-label={playing ? 'Stop playback' : 'Replay selected path'} disabled={loading || !state.selected || recording !== 'idle'} onClick={playSelected}><Icon name={playing ? 'stop' : 'play'} /></button>
      <button aria-label={saving ? 'Saving sketch' : 'Save and share sketch'} disabled={busy || recording !== 'idle' || saving}
        onClick={save}><Icon name="share" /></button>
    </div>
    {shareURL && <div className="share-panel" role="dialog" aria-label="Saved sketch link">
      <input ref={shareInput} aria-label="Shareable sketch link" readOnly value={shareURL} onFocus={event => event.target.select()} />
      <button aria-label={copied ? 'Link copied' : 'Copy link'} onClick={() => copyLink()}><Icon name={copied ? 'check' : 'copy'} /></button>
      <button aria-label="Close saved link" onClick={() => setShareURL('')}><Icon name="close" /></button>
      <span className="sr-only" role="status">{copied ? 'Link copied. Anyone with this link can open this saved sketch.' : 'Sketch saved. Anyone with this link can open it.'}</span>
    </div>}
    {loading && <span className="sr-only" role="status">Opening saved sketch</span>}
    <input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac,.aiff,.aac" multiple hidden
      onChange={event => { addFiles([...event.target.files]); event.target.value = ''; }} />
    {error && <div className="error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" /></button></div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
