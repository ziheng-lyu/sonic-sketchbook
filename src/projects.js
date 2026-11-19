import { createProjectBundle, openProjectBundle, projectName } from './bundle.js';

let connection;
function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Project storage is unavailable in this browser. Export a project file to keep your work.'));
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('sonic-sketchbook-projects', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('contents', { keyPath: 'id' });
      db.createObjectStore('settings');
    };
    request.onerror = () => { connection = null; reject(new Error('Project storage could not be opened. Export a project file to keep your work.')); };
    request.onblocked = () => { connection = null; reject(new Error('Please close other sketchbook tabs and try again.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
  });
  return connection;
}
function storageError(error) {
  return new Error(error?.name === 'QuotaExceededError'
    ? 'This browser is out of project storage. Export the project file to keep your work.'
    : 'The project could not be saved in this browser. Export a project file to keep your work.');
}
async function transaction(stores, mode, perform) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(storageError(tx.error));
    tx.onabort = () => reject(storageError(tx.error));
    try { perform(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(storageError(error)); }
  });
}
export async function listProjects() {
  const list = await transaction(['projects'], 'readonly', (tx, done) => {
    const req = tx.objectStore('projects').getAll(); req.onsuccess = () => done(req.result);
  });
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function lastProject() {
  return transaction(['settings'], 'readonly', (tx, done) => {
    const req = tx.objectStore('settings').get('last'); req.onsuccess = () => done(req.result || null);
  });
}
export async function saveProject(project, state, sources) {
  const name = projectName(project.name);
  const blob = await createProjectBundle(state, sources, name);
  const record = { id: project.id, name, updatedAt: Date.now() };
  await transaction(['projects', 'contents', 'settings'], 'readwrite', tx => {
    tx.objectStore('projects').put(record);
    tx.objectStore('contents').put({ id: project.id, blob });
    tx.objectStore('settings').put(project.id, 'last');
  });
  return { ...record, saved: true };
}
export async function openProject(id) {
  const result = await transaction(['projects', 'contents'], 'readonly', (tx, done) => {
    const details = tx.objectStore('projects').get(id), content = tx.objectStore('contents').get(id);
    let metadata, blob, complete = 0;
    const finish = () => { if (++complete === 2) done({ metadata, blob }); };
    details.onsuccess = () => { metadata = details.result; finish(); };
    content.onsuccess = () => { blob = content.result?.blob; finish(); };
  });
  if (!result.metadata || !result.blob) throw new Error('This project could not be found in this browser.');
  const loaded = await openProjectBundle(result.blob);
  return { ...loaded, project: { ...result.metadata, saved: true } };
}
// Keep the deleted bundle as a Blob for one-step recovery without decoding audio.
export async function deleteProject(id) {
  return transaction(['projects', 'contents', 'settings'], 'readwrite', (tx, done) => {
    const details = tx.objectStore('projects').get(id), content = tx.objectStore('contents').get(id);
    let metadata, contents, complete = 0;
    const finish = () => { if (++complete === 2) done(metadata && contents ? { metadata, contents } : null); };
    details.onsuccess = () => { metadata = details.result; finish(); };
    content.onsuccess = () => { contents = content.result; finish(); };
    tx.objectStore('projects').delete(id); tx.objectStore('contents').delete(id);
    const last = tx.objectStore('settings').get('last');
    last.onsuccess = () => { if (last.result === id) tx.objectStore('settings').delete('last'); };
  });
}
export async function restoreProject(record) {
  await transaction(['projects', 'contents'], 'readwrite', tx => {
    tx.objectStore('projects').put(record.metadata);
    tx.objectStore('contents').put(record.contents);
  });
}
export async function rememberProject(id) {
  await transaction(['settings'], 'readwrite', tx => {
    if (id) tx.objectStore('settings').put(id, 'last'); else tx.objectStore('settings').delete('last');
  });
}
