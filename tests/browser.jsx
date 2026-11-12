// Development-only integration checks. This page is excluded from the build.
// It exercises the real React handlers, decoder, audio clock and MediaRecorder.
import { AudioEngine } from '../src/audio.js';
const calls = [], replays = [];
const originalPlay = AudioEngine.prototype.play;
const originalReplay = AudioEngine.prototype.replay;
AudioEngine.prototype.play = function (id, when) {
  const source = originalPlay.call(this, id, when);
  calls.push({ id, when, buffer: source?.buffer, state: this.context().state });
  return source;
};
AudioEngine.prototype.replay = function (path) {
  replays.push(JSON.parse(JSON.stringify(path)));
  return originalReplay.call(this, path);
};
await import('../src/main.jsx');
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const $ = label => document.querySelector(`[aria-label="${label}"]`);
function check(condition, name) {
  const row = document.createElement('li');
  row.textContent = `${condition ? 'PASS' : 'FAIL'} ${name}`;
  row.dataset.result = condition ? 'pass' : 'fail';
  document.querySelector('#results').append(row);
  if (!condition) throw new Error(name);
}
function wav() {
  const length = 4410, view = new DataView(new ArrayBuffer(44 + length * 2));
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 330 / 44100) * 5000, true);
  return new File([view.buffer], 'test-tone.wav', { type: 'audio/wav' });
}
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true;
  try {
    await frame();
    for (let i = 0; i < 100 && document.querySelector('[aria-busy="true"]'); i++) await pause(100);
    $('Projects').click(); await frame(); $('New project').click(); await frame();
    for (let i = 0; i < 100 && document.querySelector('[aria-busy="true"]'); i++) await pause(100);
    $('Close projects')?.click(); await frame();
    const canvas = document.querySelector('svg.canvas');
    // Dispatched test events have no OS pointer, so capture alone is stubbed.
    canvas.setPointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
    const pointer = async (type, x, y, t, pointerType = 'mouse', target = canvas) => {
      const bounds = canvas.getBoundingClientRect();
      const event = new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: bounds.left + bounds.width * x, clientY: bounds.top + bounds.height * y });
      Object.defineProperty(event, 'timeStamp', { value: 10000 + t });
      target.dispatchEvent(event); await frame();
    };
    const draw = async (points, pointerType = 'mouse') => {
      await pointer('pointerdown', ...points[0], pointerType);
      for (const p of points.slice(1)) await pointer('pointermove', ...p, pointerType);
      await pointer('pointerup', ...points.at(-1), pointerType);
    };
    check(document.querySelectorAll('[data-sound]').length === 5 && document.querySelectorAll('.path').length === 0, 'Five identical starting materials; empty sketchbook');
    const homeBounds = canvas.getBoundingClientRect();
    const homes = [...document.querySelectorAll('[data-sound]')].map(node => node.transform.baseVal.getItem(0).matrix);
    check(homes.every(p => p.f <= 64) && homes.at(-1).e >= homeBounds.width - 33, 'Defaults begin in a compact top-right row, leaving the main canvas open');
    // Move the materials into the workspace to exercise the listening gestures.
    const workspace = [[.25, .31], [.63, .23], [.46, .49], [.75, .62], [.28, .72]];
    for (let i = 0; i < workspace.length; i++) {
      const target = document.querySelector(`[data-sound="seed-${i}"]`);
      const start = target.transform.baseVal.getItem(0).matrix;
      await pointer('pointerdown', start.e / homeBounds.width, start.f / homeBounds.height, 0, 'mouse', target.querySelector('circle'));
      await pointer('pointermove', ...workspace[i], 400);
      await pointer('pointerup', ...workspace[i], 400);
    }
    await pointer('pointerdown', .25, .31, 0, 'mouse', document.querySelector('[data-sound="seed-0"] circle'));
    await pointer('pointerup', .25, .31, 100);
    await pause(100);
    check(calls.length === 1 && calls[0].buffer instanceof AudioBuffer && calls[0].state === 'running', 'Click starts a real playable Web Audio buffer');
    const before = calls.length;
    await draw([[.04, .49, 0], [.96, .49, 900], [.96, .49, 1900], [.04, .49, 2800]]);
    check(document.querySelectorAll('.path').length === 1 && calls.length === before + 2, 'Fast crossings and revisits each trigger once; pause creates no extra trigger');
    $('Replay selected path').click(); await frame();
    const captured = replays.at(-1);
    check(captured.events.length === 2 && captured.events.every(e => e.soundId === 'seed-2') && captured.duration === 2800 && captured.events[1].at - captured.events[0].at > 1700, 'Replay retains gesture order and the long pause');
    const scheduled = calls.slice(-2);
    check(Math.abs((scheduled[1].when - scheduled[0].when) * 1000 - (captured.events[1].at - captured.events[0].at)) < .01, 'Original timing is scheduled on the real audio clock');
    $('Stop playback').click(); await frame();
    const transform = document.querySelector('[data-sound="seed-2"]').getAttribute('transform');
    const beforeDrag = calls.length;
    await pointer('pointerdown', .46, .49, 0, 'touch', document.querySelector('[data-sound="seed-2"] circle'));
    await pointer('pointermove', .61, .58, 400, 'touch');
    await pointer('pointerup', .61, .58, 400, 'touch');
    check(document.querySelector('[data-sound="seed-2"]').getAttribute('transform') !== transform && calls.length === beforeDrag && document.querySelectorAll('.path').length === 1, 'Touch dragging moves a circle without auditioning or drawing');
    $('Replay selected path').click(); await frame();
    check(JSON.stringify(replays.at(-1).events) === JSON.stringify(captured.events), 'Moving the sound preserves the earlier path sequence and timing');
    $('Stop playback').click(); await frame();
    await draw([[.05, .88, 0], [.9, .88, 700]], 'touch');
    check(document.querySelectorAll('.path').length === 2 && document.querySelectorAll('.path.selected').length === 1, 'Touch drawing adds a second independent, selected path');
    await pointer('pointerdown', .1, .49, 0); await pointer('pointerup', .1, .49, 100);
    check(document.querySelector('.path').getAttribute('aria-pressed') === 'true', 'Tapping an earlier mark selects that path');
    $('Undo').click(); await frame();
    $('Undo').click(); await frame();
    check(document.querySelectorAll('.path').length === 1 && document.querySelector('[data-sound="seed-2"]').getAttribute('transform') === transform, 'Undo removes the latest path then restores the moved circle');
    const input = document.querySelector('input[accept^="audio/"]');
    const transfer = new DataTransfer(); transfer.items.add(wav()); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(250); await frame();
    check(document.querySelectorAll('[data-sound]').length === 6 && !document.querySelector('[role="alert"]'), 'Audio upload decodes a real WAV and adds a neutral circle');
    const added = document.querySelectorAll('[data-sound]')[5];
    added.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })); await frame();
    check(calls.at(-1).buffer instanceof AudioBuffer && Math.abs(calls.at(-1).buffer.duration - .1) < .001, 'Uploaded audio plays its decoded buffer');
    $('Undo').click(); await frame();
    check(document.querySelectorAll('[data-sound]').length === 5, 'Undo removes an uploaded circle');
    let requested, track;
    const ctx = new AudioContext(); await ctx.resume();
    const oscillator = ctx.createOscillator(), destination = ctx.createMediaStreamDestination();
    oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
      requested = constraints; track = destination.stream.getAudioTracks()[0]; return destination.stream;
    } });
    $('Record sound').click(); await pause(1000); await frame();
    check(!!$('Finish recording') && JSON.stringify(requested) === '{"audio":true}', 'Recording requests browser-managed audio permission and exposes Stop');
    $('Finish recording').click(); await pause(500); await frame();
    check(document.querySelectorAll('[data-sound]').length === 6 && track.readyState === 'ended' && !!$('Record sound'), 'Real MediaRecorder audio decodes, adds a circle, and releases the stream');
    oscillator.stop(); await ctx.close();
    const recorded = document.querySelectorAll('[data-sound]')[5];
    recorded.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })); await frame();
    check(calls.at(-1).buffer instanceof AudioBuffer && calls.at(-1).buffer.duration > .1, 'Recorded sound is playable');
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
    $('Record sound').click(); await frame();
    check(document.querySelector('[role="alert"]')?.textContent.includes('denied') && !$('Record sound').disabled, 'Denied microphone access gives a recoverable error');
    const bad = new DataTransfer(); bad.items.add(new File(['invalid'], 'bad.wav', { type: 'audio/wav' })); input.files = bad.files;
    input.dispatchEvent(new Event('change', { bubbles: true })); await pause(100); await frame();
    check(document.querySelector('[role="alert"]')?.textContent.includes('could not be opened') && !$('Upload audio').disabled, 'Invalid audio leaves upload usable');
    $('Dismiss error').click();
    document.querySelector('#root').style.cssText = 'width:1200px;height:800px';
    document.querySelector('main').style.height = '100%';
    await frame();
    const desktop = canvas.getBoundingClientRect();
    check(desktop.width === 1200 && desktop.height === 800 && [...document.querySelectorAll('.controls button')].every(button => button.getBoundingClientRect().right <= 1200), 'Desktop layout fills 1200 by 800 with reachable controls');
    const desktopCount = calls.length;
    await draw([[.04, .49, 0], [.96, .49, 800]]);
    check(calls.length > desktopCount && document.querySelectorAll('.path').length === 2, 'Crossing sounds and drawing remain functional after desktop resize');
    await pointer('pointerdown', .25, .31, 0, 'mouse', document.querySelector('[data-sound="seed-0"] circle'));
    await pointer('pointermove', 0, .31, 400);
    await pointer('pointerup', 0, .31, 400);
    document.querySelector('#root').style.width = '320px';
    document.querySelector('#root').style.height = '640px';
    await frame();
    const narrowSound = document.querySelector('[data-sound="seed-0"]').getBoundingClientRect();
    check(canvas.getBoundingClientRect().width === 320 && narrowSound.left >= 0, 'Circles at the edge remain visible after shrinking to a 320px screen');
    const soundsBeforeSave = [...document.querySelectorAll('[data-sound]')].map(node => ({ id: node.dataset.sound, transform: node.getAttribute('transform') }));
    const pathsBeforeSave = [...document.querySelectorAll('polyline.path')].map(node => ({ points: node.getAttribute('points'), selected: node.getAttribute('aria-pressed') }));
    $('Share sketch').click();
    for (let i = 0; i < 100 && !document.querySelector('[aria-label="Shareable sketch link"]'); i++) await pause(100);
    const savedURL = $('Shareable sketch link')?.value;
    check(!!savedURL && savedURL.length < 160, 'Save produces a short shareable link with the recorded sound and all marks');
    const reopened = document.createElement('iframe');
    reopened.style.cssText = 'position:fixed;width:320px;height:640px;left:0;top:0;border:0;visibility:hidden';
    const rootURL = new URL('../', window.location.href); rootURL.hash = new URL(savedURL).hash;
    reopened.src = rootURL.href; document.body.append(reopened);
    await new Promise((resolve, reject) => { reopened.onload = resolve; setTimeout(() => reject(new Error('Restore frame timed out')), 15000); });
    let restored;
    for (let i = 0; i < 100; i++) {
      restored = reopened.contentDocument;
      if (restored?.querySelector('main') && !restored.querySelector('[aria-busy="true"]')) break;
      await pause(100);
    }
    check(!restored.querySelector('[role="alert"]') && restored.querySelectorAll('[data-sound]').length === soundsBeforeSave.length && restored.querySelectorAll('polyline.path').length === pathsBeforeSave.length, 'Opening the saved link in another page restores every sound and mark');
    check([...restored.querySelectorAll('[data-sound]')].every((node, index) => node.dataset.sound === soundsBeforeSave[index].id && node.getAttribute('transform') === soundsBeforeSave[index].transform), 'Restored circles keep the same identities and arrangement');
    check([...restored.querySelectorAll('polyline.path')].every((node, index) => node.getAttribute('points') === pathsBeforeSave[index].points && node.getAttribute('aria-pressed') === pathsBeforeSave[index].selected), 'Restored paths keep their geometry and selected state');
    restored.querySelector('[aria-label="Undo"]').click(); await pause(50);
    check(restored.querySelector('[data-sound="seed-0"]').getAttribute('transform') !== soundsBeforeSave[0].transform, 'An opened link restores the undo history, including the last circle movement');
    check(document.querySelector('[data-sound="seed-0"]').getAttribute('transform') === soundsBeforeSave[0].transform, 'Editing the reopened snapshot leaves the original page unchanged');
    reopened.remove();
    // Project saving is independent of sharing and preserves the workspace on switch.
    const projectExpected = { sounds: document.querySelectorAll('[data-sound]').length, paths: document.querySelectorAll('polyline.path').length };
    $('Projects').click(); await frame();
    const setName = async name => {
      const input = $('Project name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name);
      input.dispatchEvent(new Event('input', { bubbles: true })); await frame();
    };
    const waitIdle = async () => {
      await frame();
      for (let i = 0; i < 600 && (document.querySelector('[aria-busy="true"]') || $('Save project')?.disabled); i++) await pause(100);
    };
    await setName('QA first project'); $('Save project').click(); await waitIdle();
    check(!!$('Open project QA first project'), 'A named project is saved in the browser library');
    check(!location.hash, 'Saving a shared sketch as a project leaves a local editing address for future refreshes');
    $('New project').click(); await waitIdle();
    check(document.querySelectorAll('[data-sound]').length === 5 && !document.querySelectorAll('polyline.path').length && $('Project name').value === 'Untitled sketch', 'New project opens a fresh canvas without replacing the saved project');
    await setName('QA second project'); $('Save project').click(); await waitIdle();
    check(!!$('Open project QA first project') && !!$('Open project QA second project'), 'Multiple projects coexist in the library');
    $('Open project QA first project').click(); await waitIdle();
    check(document.querySelectorAll('[data-sound]').length === projectExpected.sounds && document.querySelectorAll('polyline.path').length === projectExpected.paths, 'Opening a project restores its sounds and marks');
    $('Projects').click(); await frame(); await setName('QA renamed project'); await pause(1300); await waitIdle();
    check(!!$('Open project QA renamed project') && !$('Open project QA first project'), 'Changes to a saved project name are saved automatically');
    document.querySelector('[data-sound="seed-0"]').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    await pause(1300); await waitIdle();
    const savedPosition = document.querySelector('[data-sound="seed-0"]').getAttribute('transform');
    const fresh = document.createElement('iframe');
    fresh.style.cssText = 'position:fixed;width:320px;height:640px;left:0;top:0;border:0;visibility:hidden';
    fresh.src = new URL('../', location.href).href; document.body.append(fresh);
    await new Promise((resolve, reject) => { fresh.onload = resolve; setTimeout(() => reject(new Error('Project reload timed out')), 15000); });
    let freshDoc;
    for (let i = 0; i < 100; i++) { freshDoc = fresh.contentDocument; if (freshDoc?.querySelector('main') && !freshDoc.querySelector('[aria-busy="true"]')) break; await pause(100); }
    check(freshDoc.querySelectorAll('[data-sound]').length === projectExpected.sounds && freshDoc.querySelectorAll('polyline.path').length === projectExpected.paths && freshDoc.querySelector('[data-sound="seed-0"]').getAttribute('transform') === savedPosition, 'A fresh page automatically reopens the last project with its latest saved edits');
    fresh.remove();
    let exportedURL;
    const clickAnchor = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download.endsWith('.sonic')) exportedURL = this.href; else clickAnchor.call(this); };
    $('Export project file').click();
    for (let i = 0; i < 100 && !exportedURL; i++) await pause(100);
    HTMLAnchorElement.prototype.click = clickAnchor;
    const exported = await (await fetch(exportedURL)).blob();
    check(exported.size > 0, 'Export produces a portable project file');
    $('New project').click(); await waitIdle();
    const projectInput = document.querySelector('input[accept^=".sonic"]');
    const projectTransfer = new DataTransfer(); projectTransfer.items.add(new File([exported], 'backup.sonic', { type: 'application/x-sonic-sketchbook' }));
    projectInput.files = projectTransfer.files; projectInput.dispatchEvent(new Event('change', { bubbles: true })); await waitIdle();
    check(document.querySelectorAll('[data-sound]').length === projectExpected.sounds && document.querySelectorAll('polyline.path').length === projectExpected.paths && $('Project name').value === 'QA renamed project', 'Import restores the project file with its name, sounds, and marks');
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota', 'QuotaExceededError'); };
    $('Save project').click(); await pause(150); await waitIdle();
    check(document.querySelector('[role="alert"]')?.textContent.includes('out of project storage'), 'Storage exhaustion gives an export recovery option');
    $('New project').click(); await pause(150); await waitIdle();
    check(document.querySelectorAll('[data-sound]').length === projectExpected.sounds && document.querySelectorAll('polyline.path').length === projectExpected.paths, 'A failed checkpoint keeps the current workspace intact');
    IDBObjectStore.prototype.put = realPut;
    $('Dismiss error').click();
    // A valid WAV with a large metadata chunk reproduces the old base64/20 MB failure.
    const originalWav = new Uint8Array(await wav().arrayBuffer());
    const junk = new Uint8Array(26 * 1024 * 1024);
    for (let offset = 0; offset < junk.length; offset += 65536) crypto.getRandomValues(junk.subarray(offset, Math.min(junk.length, offset + 65536)));
    const prefix = originalWav.slice(0, 12), chunkHeader = new Uint8Array(8);
    chunkHeader.set(new TextEncoder().encode('JUNK')); new DataView(chunkHeader.buffer).setUint32(4, junk.length, true);
    new DataView(prefix.buffer).setUint32(4, originalWav.length + junk.length, true);
    const largeAudio = new File([prefix, chunkHeader, junk, originalWav.slice(12)], 'large-original.wav', { type: 'audio/wav' });
    const largeTransfer = new DataTransfer(); largeTransfer.items.add(largeAudio); input.files = largeTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 300 && document.querySelectorAll('[data-sound]').length === projectExpected.sounds; i++) await pause(100);
    check(document.querySelectorAll('[data-sound]').length === projectExpected.sounds + 1, 'An actual audio file larger than 20 MB imports successfully');
    await waitIdle(); $('Save project').click(); await waitIdle();
    check(!document.querySelector('[role="alert"]'), 'The large audio project saves locally without the sharing limit');
    $('Share sketch').click();
    for (let i = 0; i < 600 && !document.querySelector('[aria-label="Shareable sketch link"]'); i++) await pause(100);
    const largeLink = $('Shareable sketch link')?.value;
    check(largeLink?.includes('#s2=') && !document.querySelector('[role="alert"]'), 'A project exceeding 20 MB shares through encrypted chunks');
    check(!location.hash, 'Sharing a saved project keeps refresh linked to the latest local project');
    const checkFrame = document.createElement('iframe'); checkFrame.style.cssText = 'position:fixed;width:320px;height:640px;left:0;top:0;border:0;visibility:hidden';
    const largeRoot = new URL('../', location.href); largeRoot.hash = new URL(largeLink).hash; checkFrame.src = largeRoot.href; document.body.append(checkFrame);
    await new Promise((resolve, reject) => { checkFrame.onload = resolve; setTimeout(() => reject(new Error('Large restore timed out')), 30000); });
    let largeDoc;
    for (let i = 0; i < 600; i++) { largeDoc = checkFrame.contentDocument; if (largeDoc?.querySelector('main') && !largeDoc.querySelector('[aria-busy="true"]')) break; await pause(100); }
    check(!largeDoc.querySelector('[role="alert"]') && largeDoc.querySelectorAll('[data-sound]').length === projectExpected.sounds + 1, 'The large shared project reopens with its playable original audio');
    checkFrame.remove();
    const summary = document.createElement('strong'); summary.textContent = 'All browser checks passed.'; document.querySelector('#report').append(summary);
  } catch (error) {
    const summary = document.createElement('strong'); summary.textContent = `Browser checks stopped: ${error.message}`; document.querySelector('#report').append(summary);
    console.error(error);
  }
};
