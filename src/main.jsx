import React, { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { frameDrag } from './frame-drag.js';
import { AudioEngine } from './audio.js';
import { Microphone } from './recorder.js';
import { keepOnCanvas, nearestPath, soundPosition, soundPadding } from './geometry.js';
import { ListeningGesture } from './listening.js';
import { initialState, reducer } from './model.js';
import { isSavedLink, loadSketch, saveSketch } from './share.js';
import * as projectStore from './projects.js';
import { createProjectBundle, openProjectBundle, projectName } from './bundle.js';
import { ProjectPanel } from './ProjectPanel.jsx';
import { SoundMark, SoundOptions } from './SoundOptions.jsx';
import { soundShape, soundMode, soundScale } from './shapes.js';
import './style.css';

function Icon({ name }) {
  const icons = {
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v4m-3 0h6"/></>,
    undo: <><path d="m8 5-5 5 5 5"/><path d="M3 10h10a7 7 0 0 1 7 7v2"/></>,
    clear: <><path d="m4 14 9-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-8 9H8l-4-4a2 2 0 0 1 0-2Zm5-5 8 8M12 20h9" /></>,
    play: <path d="m9 5 10 7-10 7Z"/>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
    share: <><path d="m10 13 4-4"/><path d="M8 16H6a4 4 0 0 1-3-7l4-4a4 4 0 0 1 6 0M16 8h2a4 4 0 0 1 3 7l-4 4a4 4 0 0 1-6 0"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

const StoredPath = memo(function StoredPath({ path, size, selected, opacity, onSelect, index }) {
  const points = useMemo(() => path.points.map(p => `${p.x * size.width},${p.y * size.height}`).join(' '), [path, size]);
  return <polyline points={points} className={`path${selected ? ' selected' : ''}`}
    style={{ '--age-opacity': opacity }} role="button" tabIndex="0" aria-label={`Select path ${index + 1}`} aria-pressed={selected}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ type: 'select', id: path.id }); } }} />;
});

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [draft, setDraft] = useState(null);
  const [moving, setMoving] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState('idle');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shareURL, setShareURL] = useState('');
  const [copied, setCopied] = useState(false);
  const [soundMenu, setSoundMenu] = useState(null);
  const [sizePreview, setSizePreview] = useState(null);
  const restoring = useRef(loading), lastSaved = useRef(null), shareInput = useRef(null);
  const svg = useRef(null), fileInput = useRef(null), gesture = useRef(null);
  const engine = useRef(null), microphone = useRef(null), playTimer = useRef(null);
  const playbackEpoch = useRef(0), mounted = useRef(true), current = useRef(state);
  current.current = state;
  const viewSounds = useMemo(() => state.sounds.map(sound => {
    const visible = sizePreview?.id === sound.id ? { ...sound, scale: sizePreview.scale } : sound;
    return { ...visible, ...soundPosition(visible, size) };
  }), [state.sounds, sizePreview, size]);
  const optionSound = viewSounds.find(sound => sound.id === soundMenu);
  if (!engine.current) engine.current = new AudioEngine();

  const [project, setProject] = useState(() => ({ id: crypto.randomUUID(), name: 'Untitled sketch', saved: false }));
  const [projectList, setProjectList] = useState([]);
  const [projectMenu, setProjectMenu] = useState(false);
  const [projectWorking, setProjectWorking] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const [localStatus, setLocalStatus] = useState('Not saved yet');
  const projectRef = useRef(project), savedProjectRef = useRef(null), projectQueue = useRef(Promise.resolve());
  const autoSaveTimer = useRef(null), draftFrame = useRef(null);
  const [deletedProject, setDeletedProject] = useState(null);
  const projectFileInput = useRef(null), saveProjectAction = useRef(null), navigation = useRef(0);
  projectRef.current = project;

  async function refreshProjects() { const items = await projectStore.listProjects(); if (mounted.current) setProjectList(items); }
  function persistCurrent() {
    const snapshot = current.current, metadata = { ...projectRef.current }, sources = new Map(engine.current.sources);
    const task = async () => {
      setLocalSaving(true); setLocalStatus('Saving…');
      try {
        const saved = await projectStore.saveProject(metadata, snapshot, sources);
        if (mounted.current && projectRef.current.id === metadata.id) {
          savedProjectRef.current = { state: snapshot, name: projectName(metadata.name) };
          const next = { ...projectRef.current, saved: true, updatedAt: saved.updatedAt };
          if (next.name === metadata.name) next.name = saved.name;
          projectRef.current = next; setProject(next); setLocalStatus('Saved in this browser');
          if (!restoring.current && isSavedLink(window.location.hash)) window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        await refreshProjects(); return saved;
      } catch (failure) { if (mounted.current) setLocalStatus('Not saved'); throw failure; }
      finally { if (mounted.current) setLocalSaving(false); }
    };
    const pending = projectQueue.current.catch(() => {}).then(task);
    projectQueue.current = pending;
    return pending;
  }
  saveProjectAction.current = () => {
    if (recording !== 'idle' || importing || projectWorking || restoring.current) return;
    return persistCurrent().catch(failure => report(failure.message));
  };
  async function checkpoint() {
    const p = projectRef.current, doc = current.current;
    if (p.saved || doc.history.length || engine.current.sources.size || p.name !== 'Untitled sketch') await persistCurrent();
    else await projectQueue.current.catch(() => {});
  }
  function setActiveProject(value) { projectRef.current = value; setProject(value); }
  async function installProject(saved, metadata, token) {
    if (token !== navigation.current) return false;
    const ready = await engine.current.restoreSources(saved.sources, () => mounted.current && token === navigation.current);
    if (!ready || token !== navigation.current) return false;
    cancelGesture(); stopPlayback();
    current.current = saved.state; dispatch({ type: 'restore', state: saved.state });
    setActiveProject(metadata);
    savedProjectRef.current = metadata.saved ? { state: saved.state, name: projectName(metadata.name) } : null;
    setLocalStatus(metadata.saved ? 'Saved in this browser' : 'Not saved yet');
    lastSaved.current = null; setShareURL(''); setSoundMenu(null); setSizePreview(null); setError('');
    return true;
  }
  async function changeProject(id) {
    if (projectWorking || restoring.current || recording !== 'idle' || importing) return;
    if (id === projectRef.current.id) { setProjectMenu(false); return; }
    clearTimeout(autoSaveTimer.current);
    const token = ++navigation.current;
    restoring.current = true; setProjectWorking(true); setLoading(true);
    cancelGesture(); stopPlayback();
    try {
      await checkpoint();
      const saved = id ? await projectStore.openProject(id) : { state: initialState(), sources: new Map() };
      const metadata = id ? saved.project : { id: crypto.randomUUID(), name: 'Untitled sketch', saved: false };
      if (await installProject(saved, metadata, token)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        await projectStore.rememberProject(id || null);
        setProjectMenu(!id);
      }
    } catch (failure) { report(failure.message); }
    finally { if (token === navigation.current) { restoring.current = false; setProjectWorking(false); setLoading(false); } }
  }
  async function deleteSavedProject(id) {
    if (projectWorking || localSaving || restoring.current || importing || recording !== 'idle') return;
    clearTimeout(autoSaveTimer.current);
    restoring.current = true; setProjectWorking(true);
    try {
      await projectQueue.current.catch(() => {});
      const active = id === projectRef.current.id;
      const recovery = active ? {
        metadata: { id, name: projectName(projectRef.current.name), updatedAt: Date.now() },
        contents: { id, blob: await createProjectBundle(current.current, engine.current.sources, projectRef.current.name) },
      } : null;
      const removed = await projectStore.deleteProject(id);
      if (removed) setDeletedProject(recovery || removed);
      if (id === projectRef.current.id) {
        const token = ++navigation.current;
        await installProject({ state: initialState(), sources: new Map() }, { id: crypto.randomUUID(), name: 'Untitled sketch', saved: false }, token);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      await refreshProjects();
    } catch (failure) { report(failure.message); }
    finally { restoring.current = false; setProjectWorking(false); }
  }
  async function undoProjectDeletion() {
    if (!deletedProject || projectWorking || localSaving || restoring.current) return;
    setProjectWorking(true);
    try { await projectStore.restoreProject(deletedProject); await refreshProjects(); setDeletedProject(null); }
    catch (failure) { report(failure.message); }
    finally { setProjectWorking(false); }
  }
  async function exportProjectFile() {
    if (projectWorking || restoring.current || recording !== 'idle' || importing) return;
    setProjectWorking(true);
    try {
      const blob = await createProjectBundle(current.current, engine.current.sources, projectRef.current.name);
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = projectName(projectRef.current.name).replace(/[^\w\- .]/g, '_') + '.sonic';
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setLocalStatus('Project file exported');
    } catch (failure) { report(failure.message); }
    finally { setProjectWorking(false); }
  }
  async function importProjectFile(file) {
    if (!file || projectWorking || restoring.current || recording !== 'idle' || importing) return;
    clearTimeout(autoSaveTimer.current);
    const token = ++navigation.current;
    restoring.current = true; setLoading(true); setProjectWorking(true);
    cancelGesture(); stopPlayback();
    try {
      const saved = await openProjectBundle(file);
      await checkpoint();
      if (await installProject(saved, { id: crypto.randomUUID(), name: saved.name, saved: false }, token)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        await persistCurrent(); setProjectMenu(true);
      }
    } catch (failure) { report(failure.message); }
    finally { if (token === navigation.current) { restoring.current = false; setLoading(false); setProjectWorking(false); } }
  }
  useEffect(() => {
    if (!project.saved || loading || projectWorking || importing || recording !== 'idle') return;
    if (savedProjectRef.current?.state === state && savedProjectRef.current.name === projectName(project.name)) return;
    setLocalStatus('Unsaved changes');
    const saveWhenIdle = () => {
      if (gesture.current) { autoSaveTimer.current = setTimeout(saveWhenIdle, 800); return; }
      persistCurrent().catch(failure => report(failure.message));
    };
    autoSaveTimer.current = setTimeout(saveWhenIdle, 800);
    return () => clearTimeout(autoSaveTimer.current);
  }, [state, project.name, project.saved, project.id, loading, projectWorking, importing, recording]);

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
    cancelGesture();
    stopPlayback(); dispatch({ type: 'undo' });
  }

  function editCanvas(action) {
    if (restoring.current) return;
    cancelGesture(); setSoundMenu(null); setSizePreview(null);
    stopPlayback(); dispatch(action);
  }

  function shareError(failure) {
    const message = failure?.message || '';
    return /^(This |An audio |The |Please |Saving |Sharing |Project |Saved )/.test(message)
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
    const sharingProjectId = projectRef.current.id;
    try {
      const name = projectName(projectRef.current.name);
      const url = lastSaved.current?.state === snapshot && lastSaved.current.name === name ? lastSaved.current.url
        : await saveSketch(snapshot, engine.current.sources, window.location.href, fetch, name);
      if (!mounted.current || projectRef.current.id !== sharingProjectId) return;
      lastSaved.current = { state: snapshot, name, url };
      setShareURL(url);
      if (!projectRef.current.saved) window.history.replaceState(null, '', url);
      await copyLink(url);
    } catch (failure) { report(shareError(failure)); }
    finally { if (mounted.current) setSaving(false); }
  }

  useEffect(() => {
    let active = true, first = true;
    async function restore() {
      clearTimeout(autoSaveTimer.current);
      const token = ++navigation.current;
      const hash = window.location.hash;
      restoring.current = true; setLoading(true); setShareURL(''); setProjectMenu(false); setError('');
      cancelGesture(); stopPlayback();
      try {
        if (isSavedLink(hash)) {
          const saved = await loadSketch(hash);
          if (!active || token !== navigation.current) return;
          const name = saved.name || 'Shared sketch';
          if (await installProject(saved, { id: crypto.randomUUID(), name, saved: false }, token))
            lastSaved.current = { state: saved.state, name: projectName(name), url: window.location.href };
        } else if (first) {
          const id = await projectStore.lastProject();
          if (!active || token !== navigation.current) return;
          if (id) {
            const saved = await projectStore.openProject(id);
            await installProject(saved, saved.project, token);
          }
        }
        if (active) await refreshProjects();
      } catch (failure) { if (active && token === navigation.current) report(shareError(failure)); }
      finally {
        first = false;
        if (active && token === navigation.current) { restoring.current = false; setLoading(false); }
      }
    }
    restore(); window.addEventListener('hashchange', restore);
    return () => { active = false; navigation.current++; window.removeEventListener('hashchange', restore); };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (gesture.current) stopPlayback();
      cancelGesture();
      setSize({ width: Math.max(1, width), height: Math.max(1, height) });
    });
    observer.observe(svg.current);
    const onKey = event => {
      const editing = event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!restoring.current) saveProjectAction.current?.(); return; }
      if (editing && event.key !== 'Escape') return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault(); undo();
      }
      if (event.key === 'Escape') {
        cancelGesture(); stopPlayback(); setError(''); setShareURL(''); setProjectMenu(false); setSoundMenu(null); setSizePreview(null);
      }
      if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); playSelected(); }
    };
    const onVisibility = () => {
      if (document.hidden) { stopPlayback(); cancelGesture(); }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      observer.disconnect(); window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      gesture.current?.preview?.cancel(); gesture.current = null;
      clearTimeout(autoSaveTimer.current); cancelAnimationFrame(draftFrame.current);
      clearTimeout(playTimer.current); engine.current.dispose(); microphone.current?.dispose();
    };
  }, []);

  function cancelGesture() {
    const active = gesture.current; gesture.current = null;
    if (active?.preview) {
      active.preview.cancel();
      active.node.setAttribute('transform', `translate(${active.sound.x * active.size.width} ${active.sound.y * active.size.height})`);
      active.node.style.removeProperty('transform'); active.node.style.removeProperty('will-change');
    }
    cancelAnimationFrame(draftFrame.current); draftFrame.current = null;
    setDraft(null); setMoving(null);
    if (active && svg.current?.hasPointerCapture(active.pointerId)) svg.current.releasePointerCapture(active.pointerId);
  }
  function point(event, started = event.timeStamp, rect = svg.current.getBoundingClientRect()) {
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)), t: Math.max(0, event.timeStamp - started) };
  }
  function pointerDown(event) {
    if (event.button !== 0 || gesture.current || restoring.current) return;
    if (sizePreview) dispatch({ type: 'configure', id: sizePreview.id, scale: sizePreview.scale });
    setShareURL(''); setProjectMenu(false); setSoundMenu(null); setSizePreview(null);
    event.preventDefault();
    stopPlayback(); unlock();
    const rect = svg.current.getBoundingClientRect();
    const p = point(event, event.timeStamp, rect);
    const id = event.target.closest('[data-sound]')?.dataset.sound;
    const sound = viewSounds.find(item => item.id === id);
    const base = { pointerId: event.pointerId, started: event.timeStamp, start: p, moved: false, rect, size: { ...size } };
    gesture.current = sound
      ? { ...base, type: 'move', sound, position: { x: sound.x, y: sound.y } }
      : { ...base, type: 'draw', points: [p], listening: new ListeningGesture(viewSounds, size) };
    svg.current.setPointerCapture(event.pointerId);
    if (sound) {
      const active = gesture.current;
      active.node = event.target.closest('[data-sound]');
      active.node.style.willChange = 'transform';
      active.preview = frameDrag(position => {
        active.node.style.transform = `translate3d(${position.x * active.size.width}px,${position.y * active.size.height}px,0)`;
      });
      setMoving({ id: sound.id, x: sound.x, y: sound.y });
    }
  }
  function sample(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    const p = point(event, g.started, g.rect);
    const travel = Math.hypot((p.x - g.start.x) * g.size.width, (p.y - g.start.y) * g.size.height);
    if (travel > 3) g.moved = true;
    if (g.type === 'move') {
      if (!g.moved) return;
      g.position = keepOnCanvas({ x: g.sound.x + p.x - g.start.x, y: g.sound.y + p.y - g.start.y }, g.size, soundPadding(g.sound));
      g.preview.update(g.position);
    } else {
      const previous = g.points.at(-1);
      if (p.x === previous.x && p.y === previous.y && p.t === previous.t) return;
      if (g.moved) g.listening.advance(previous, p).forEach(update => engine.current.listen(update));
      g.points.push(p);
      if (g.moved && draftFrame.current === null) draftFrame.current = requestAnimationFrame(() => {
        draftFrame.current = null;
        if (gesture.current === g) setDraft([...g.points]);
      });
    }
  }
  function pointerMove(event) {
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    if (gesture.current?.type === 'move') sample(samples.at(-1) || event);
    else if (samples.length) samples.forEach(sample);
    else sample(event);
  }
  function pointerUp(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    sample(event);
    if (g.preview) {
      g.preview.finish(g.position);
      g.node.setAttribute('transform', `translate(${g.position.x * g.size.width} ${g.position.y * g.size.height})`);
      g.node.style.removeProperty('transform'); g.node.style.removeProperty('will-change');
    }
    gesture.current = null; cancelAnimationFrame(draftFrame.current); draftFrame.current = null; setDraft(null); setMoving(null);
    if (svg.current.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    if (g.type === 'move') {
      if (g.moved) dispatch({ type: 'move', id: g.sound.id, position: g.position });
      else { audition(g.sound.id); setSoundMenu(g.sound.id); }
    } else if (g.moved) {
      const duration = Math.max(0, event.timeStamp - g.started);
      g.listening.finish(duration).forEach(update => engine.current.listen(update));
      dispatch({ type: 'path', path: { id: crypto.randomUUID(), points: g.points, events: g.listening.events, duration } });
    } else {
      const hit = nearestPath({ x: g.start.x * size.width, y: g.start.y * size.height }, state.paths, size);
      if (hit) dispatch({ type: 'select', id: hit });
    }
  }
  function cancelPointer(event) {
    if (gesture.current?.pointerId === event.pointerId) { cancelGesture(); stopPlayback(); }
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
      const clearance = q => Math.min(...sounds.map(sound => {
        const p = soundPosition(sound, size);
        return Math.hypot((p.x - q.x) * size.width, (p.y - q.y) * size.height);
      }));
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
  const busy = loading || projectWorking || recording === 'requesting' || recording === 'saving' || importing;
  return <main className="sketchbook" aria-busy={loading || saving} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}>
    <button className="projects-toggle" aria-label="Projects" aria-expanded={projectMenu} disabled={busy || recording !== 'idle'}
      onClick={() => { setProjectMenu(!projectMenu); setSoundMenu(null); setSizePreview(null); setShareURL(''); refreshProjects().catch(failure => report(failure.message)); }}><Icon name="folder" /></button>
    {projectMenu && <ProjectPanel project={project} projects={projectList} status={localSaving ? 'Saving…' : localStatus}
      working={projectWorking || loading || importing || recording !== 'idle' || localSaving}
      onName={name => { setActiveProject({ ...projectRef.current, name }); setLocalStatus('Unsaved changes'); }}
      onSave={() => saveProjectAction.current?.()} onNew={() => changeProject(null)} onOpen={changeProject}
      onDelete={deleteSavedProject} deleted={deletedProject} onRestore={undoProjectDeletion}
      onExport={exportProjectFile} onImport={() => projectFileInput.current.click()} onClose={() => setProjectMenu(false)} />}
    <input ref={projectFileInput} type="file" accept=".sonic,application/x-sonic-sketchbook" hidden
      onChange={event => { const file = event.target.files[0]; event.target.value = ''; importProjectFile(file); }} />
    <svg ref={svg} className={`canvas${moving ? ' moving' : ''}`} aria-label="Sound sketchbook" role="group"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}>
      {state.paths.map((path, index) => <StoredPath key={path.id} path={path} size={size}
        selected={path.id === state.selected && !draft} index={index} onSelect={dispatch}
        opacity={Math.max(.3, .55 + .3 * index / Math.max(1, state.paths.length - 1))} />)}
      {draft && <polyline points={line(draft)} className="path selected draft" />}
      {viewSounds.map((sound, index) => {
        const active = gesture.current;
        const position = active?.type === 'move' && active.sound.id === sound.id ? active.position : sound;
        return <g key={sound.id} data-sound={sound.id} data-mode={soundMode(sound)} data-shape={soundShape(sound)} data-scale={soundScale(sound)} className="sound" transform={`translate(${position.x * size.width} ${position.y * size.height})`}
          role="button" tabIndex="0" aria-label={`Play sound ${index + 1}`}
          onKeyDown={event => {
            if (restoring.current) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); audition(sound.id); setSoundMenu(sound.id); }
            const steps = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
            if (steps[event.key]) {
              event.preventDefault(); stopPlayback();
              const [x, y] = steps[event.key];
              dispatch({ type: 'move', id: sound.id, position: keepOnCanvas({ x: sound.x + x / size.width, y: sound.y + y / size.height }, size, soundPadding(sound)) });
            }
          }}>
          <SoundMark sound={sound} />
        </g>;
      })}
    </svg>
    {optionSound && <SoundOptions key={optionSound.id} sound={optionSound} position={optionSound} size={size}
      onChange={change => { stopPlayback(); setSizePreview(null); dispatch({ type: 'configure', id: optionSound.id, ...change }); }}
      onDelete={() => editCanvas({ type: 'remove-sound', id: optionSound.id })}
      onSizePreview={scale => { stopPlayback(); setSizePreview(scale === null ? null : { id: optionSound.id, scale }); }}
      onClose={() => { setSoundMenu(null); setSizePreview(null); }} />}
    <div className="controls" role="toolbar" aria-label="Sketchbook controls">
      <button aria-label="Upload audio" disabled={busy} onClick={() => fileInput.current.click()}><Icon name="upload" /></button>
      <button aria-label={recording === 'recording' ? 'Finish recording' : recording === 'requesting' ? 'Waiting for microphone permission' : 'Record sound'}
        className={recording === 'recording' ? 'recording' : ''} disabled={busy} onClick={record} aria-pressed={recording === 'recording'}>
        <Icon name={recording === 'recording' ? 'stop' : 'mic'} />
      </button>
      <span className="divider" aria-hidden="true" />
      <button aria-label="Undo" disabled={loading || !state.history.length} onClick={undo}><Icon name="undo" /></button>
      <button aria-label="Clear all lines" disabled={busy || !state.paths.length || recording !== 'idle'}
        onClick={() => editCanvas({ type: 'clear-paths' })}><Icon name="clear" /></button>
      <button aria-label={playing ? 'Stop playback' : 'Replay selected path'} disabled={loading || !state.selected || recording !== 'idle'} onClick={playSelected}><Icon name={playing ? 'stop' : 'play'} /></button>
      <button aria-label={saving ? 'Sharing sketch' : 'Share sketch'} disabled={busy || recording !== 'idle' || saving}
        onClick={save}><Icon name="share" /></button>
    </div>
    {shareURL && <div className="share-panel" role="dialog" aria-label="Saved sketch link">
      <input ref={shareInput} aria-label="Shareable sketch link" readOnly value={shareURL} onFocus={event => event.target.select()} />
      <button aria-label="Copy link" onClick={() => copyLink()}><Icon name="copy" /></button>
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
