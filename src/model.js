import { validOutline } from './custom-shape.js';
import { VALID_SHAPES, MODES } from './shapes.js';
import { initialSounds } from './geometry.js';

export function initialState() {
  return { sounds: initialSounds.map(sound => ({ ...sound })), paths: [], selected: null, history: [] };
}

export function reducer(state, action) {
  if (action.type === 'restore') return action.state;
  if (action.type === 'select') return { ...state, selected: action.id };
  if (action.type === 'undo') {
    if (!state.history.length) return state;
    return { ...state.history.at(-1), history: state.history.slice(0, -1) };
  }
  const previous = { sounds: state.sounds, paths: state.paths, selected: state.selected };
  let next;
  if (action.type === 'path') next = { ...state, paths: [...state.paths, action.path], selected: action.path.id };
  if (action.type === 'move') next = { ...state, sounds: state.sounds.map(sound => sound.id === action.id ? { ...sound, ...action.position, ...(sound.parked ? { parked: false } : {}) } : sound) };
  if (action.type === 'configure' && (!action.mode || MODES.includes(action.mode)) && (!action.shape || VALID_SHAPES.includes(action.shape))) {
    const sound = state.sounds.find(item => item.id === action.id);
    const shape = action.shape || sound?.shape || 'circle', outline = action.outline || sound?.outline;
    if ((action.outline || shape === 'custom') && !validOutline(outline)) return state;
    const changed = sound && ((action.mode && action.mode !== (sound.mode || 'trigger')) || (action.shape && action.shape !== (sound.shape || 'circle')) || (action.outline && action.outline !== sound.outline));
    if (changed) next = { ...state, sounds: state.sounds.map(item => item.id === action.id ? { ...item, ...(action.mode ? { mode: action.mode } : {}), ...(action.shape ? { shape: action.shape } : {}), ...(action.outline ? { outline: action.outline } : {}) } : item) };
  }
  if (action.type === 'add') next = { ...state, sounds: [...state.sounds, ...action.sounds] };
  return next ? { ...next, history: [...state.history, previous] } : state;
}
