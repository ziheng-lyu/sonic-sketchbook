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
  if (action.type === 'move') next = { ...state, sounds: state.sounds.map(sound => sound.id === action.id ? { ...sound, ...action.position } : sound) };
  if (action.type === 'add') next = { ...state, sounds: [...state.sounds, ...action.sounds] };
  return next ? { ...next, history: [...state.history, previous] } : state;
}
