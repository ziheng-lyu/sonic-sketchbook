# Listening sketchbook

A minimal React and Web Audio research prototype for arranging sounds and drawing paths through them. Different gestures create different listening experiences from the same material.

## Run

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Microphone capture requires localhost or HTTPS and browser permission. `npm run build` creates the static app in `dist/`.

## GitHub Pages

The included workflow tests, builds, and publishes the app when `main` changes. In the repository's **Settings → Pages**, set the source to **GitHub Actions**. The site is public and requires no account to use. Imported and recorded audio stays in the visitor's browser.

## Interactions

- Click or tap a circle to audition it. Drag a circle to move it.
- Draw on empty canvas to make a listening path. Entering a circle triggers its sound; leaving and returning triggers it again. Sound playback can overlap naturally.
- A released path stays visible and becomes selected. Tap an earlier line to select it. The play icon replays the selected path; it becomes a stop icon during playback.
- Upload audio files or use the microphone icon to begin and finish a recording. Files dropped on the canvas also work.
- Undo reverses the latest drawing, sound movement, or sound addition. A multi-file upload is one action.
- Keyboard access includes Tab, Enter/Space to audition or select, arrow keys to move a focused sound, Command/Ctrl+Z to undo, and Escape to stop playback or cancel an active gesture.

The interface shows no instructions or sound labels. Accessible names are available to assistive technology.

## Behavior and scope

Five distinct nonverbal sounds are synthesized as original PCM buffers in Web Audio. Imported and recorded material is decoded into the same buffer registry. There is no remote processing, interpretation, recommendation, or generation in response to marks.

Pointer events support mouse, pen and touch. Circle entry is tested against each complete movement segment so sparse pointer samples still detect fast crossings in spatial order. Timing is interpolated between gesture samples. Stationary samples and the gesture duration retain pauses. Each completed path stores its sound IDs and trigger times independently of circle positions. Replay schedules those original events directly on the audio clock, including repeated sounds and overlapping tails.

Paths and positions scale with the canvas. Edge circles remain reachable on small screens. An interrupted pointer gesture is discarded; completed marks remain. Playback stops when the page is hidden. Recording tracks are released on stop, error, or teardown.

Sketches and audio stay in memory for the current page session. Reloading starts a fresh sketchbook. There is no account, analytics, server upload, or autosave.

## Verification

`npm test` runs 11 checks covering crossing geometry, timing, selection, undo, distinct PCM buffers, replay scheduling, decoded audio, and microphone lifecycle.

With the dev server running, open `/tests/browser.html` and click **Run browser checks**. The development-only page exercises the actual React event handlers, Web Audio buffers and clock, real WAV decoding, and real MediaRecorder encoding/decoding from a controlled audio stream. It checks touch event handling, importing, recording, permission denial, failed imports, and responsive layouts. The test page is excluded from the production build. Native browser gestures also verified circle audition, dragging, multiple paths, selection, and replay controls.

Microphone integration is verified with a controlled stream. Physical microphone hardware and a separate physical touch device have not been tested.
