# Listening sketchbook

A minimal React and Web Audio research prototype for arranging sounds and drawing paths through them. Different gestures create different listening experiences from the same material.

## Run

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Microphone capture requires localhost or HTTPS and browser permission. `npm run build` creates the static app in `dist/`.

## GitHub Pages

The included workflow tests, builds, and publishes the app when `main` changes. In the repository's **Settings → Pages**, set the source to **GitHub Actions**. The site is public and requires no account to use. Audio stays in the visitor's browser until they explicitly save a shareable snapshot.

## Interactions

- Click or tap a circle to audition it. Drag a circle to move it.
- Draw on empty canvas to make a listening path. Entering a circle triggers its sound; leaving and returning triggers it again. Sound playback can overlap naturally.
- A released path stays visible and becomes selected. Tap an earlier line to select it. The play icon replays the selected path; it becomes a stop icon during playback.
- Upload audio files or use the microphone icon to begin and finish a recording. Files dropped on the canvas also work.
- Undo reverses the latest drawing, sound movement, or sound addition. A multi-file upload is one action.
- The link icon saves a snapshot and shows its shareable link. Copy it to reopen the same sketchbook on another device. It includes sound materials, circle positions, every existing path, exact playback timing, selected path, and the undo history. Opening the link lets someone continue sketching; a later save creates a separate snapshot.
- Keyboard access includes Tab, Enter/Space to audition or select, arrow keys to move a focused sound, Command/Ctrl+Z to undo, and Escape to stop playback or cancel an active gesture.

The interface shows no instructions or sound labels. Accessible names are available to assistive technology.

## Behavior and scope

Five identical circles begin in a compact row at the top right, leaving the main canvas open for personal material. Unused defaults stay in that corner when the viewport changes. Dragging one into the workspace makes it freely positioned; Undo returns it to the row. Previously saved links retain their saved arrangements.

Five distinct nonverbal sounds are synthesized as original PCM buffers in Web Audio. Imported and recorded material is decoded into the same buffer registry. There is no remote processing, interpretation, recommendation, or generation in response to marks.

Pointer events support mouse, pen and touch. Circle entry is tested against each complete movement segment so sparse pointer samples still detect fast crossings in spatial order. Timing is interpolated between gesture samples. Stationary samples and the gesture duration retain pauses. Each completed path stores its sound IDs and trigger times independently of circle positions. Replay schedules those original events directly on the audio clock, including repeated sounds and overlapping tails.

Paths and positions scale with the canvas. Edge circles remain reachable on small screens. An interrupted pointer gesture is discarded; completed marks remain. Playback stops when the page is hidden. Recording tracks are released on stop, error, or teardown.

Unsaved work stays in memory. The plain URL opens a fresh sketchbook. A saved link restores its snapshot after refresh or on another device. There are no accounts, analytics, or automatic uploads.

## Saved links

The frontend remains on GitHub Pages. The small storage service in `sharing-service/` runs separately with an R2 bucket. Saving compresses the original audio files and sketch data, then encrypts the result with a fresh AES-256-GCM key in the browser. Only encrypted bytes are uploaded. The key lives in the link's URL fragment and is never sent to the storage service. Treat the complete link as access to the sketch: anyone you give it to can open the sounds and marks.

Snapshots are immutable and do not expire automatically. Sharing a later version does not change earlier links. Current limits are 20 MB per encrypted snapshot and 32 MB of uncompressed snapshot JSON; an over-limit save leaves the current sketch untouched. Upload grants last five minutes, are single-use, and cannot overwrite or delete a saved snapshot. The API exposes no listing of saved sketches.

For local integration testing, run `node tests/storage-server.mjs` in one terminal, then `VITE_SHARE_API=http://127.0.0.1:4177 npm run dev` in another. Test storage is in memory and disappears when that server stops. The production API URL is in `src/share.js`; it contains no credentials.

## Verification

`npm test` runs 25 checks covering crossing geometry, timing, selection, undo, distinct PCM buffers, replay scheduling, decoded audio, microphone lifecycle, encrypted snapshot round trips, cross-client reopening, retained undo, upload authorization, immutable saves, and malformed links.

With the dev server running, open `/tests/browser.html` and click **Run browser checks**. The development-only page exercises the actual React event handlers, Web Audio buffers and clock, real WAV decoding, and real MediaRecorder encoding/decoding from a controlled audio stream. It checks touch event handling, importing, recording, permission denial, failed imports, and responsive layouts. The additional sharing checks use the local integration service and reopen a saved link in a fresh page to verify restored audio materials, marks, positions, selection, and undo. The test page is excluded from the production build. Native browser gestures also verified circle audition, dragging, multiple paths, selection, and replay controls.

Microphone integration is verified with a controlled stream. Physical microphone hardware and a separate physical touch device have not been tested.
