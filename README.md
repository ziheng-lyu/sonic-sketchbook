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
- Draw on empty canvas to make a listening path. Entering a sound area starts its sound. Loudness follows distance continuously: the center is loudest, the outer edge is silent. Leaving fades the sound out; returning starts it again. Pausing does not restart or loop audio. Clips retain their original duration.
- A released path stays visible and becomes selected. Tap an earlier line to select it. The play icon replays the selected path; it becomes a stop icon during playback.
- Upload audio files or use the microphone icon to begin and finish a recording. Files dropped on the canvas also work.
- Undo reverses the latest drawing, sound movement, or sound addition. A multi-file upload is one action.
- The link icon creates a shared snapshot and shows its shareable link. Project saving is available separately in the folder menu. Copy it to reopen the same sketchbook on another device. It includes sound materials, circle positions, every existing path, exact playback timing, selected path, and the undo history. Opening the link lets someone continue sketching; a later save creates a separate snapshot.
- Keyboard access includes Tab, Enter/Space to audition or select, arrow keys to move a focused sound, Command/Ctrl+Z to undo, and Escape to stop playback or cancel an active gesture.

The interface shows no instructions or sound labels. Accessible names are available to assistive technology.

## Behavior and scope

Five identical circles begin in a compact row at the top right, leaving the main canvas open for personal material. Unused defaults stay in that corner when the viewport changes. Dragging one into the workspace makes it freely positioned; Undo returns it to the row. Previously saved links retain their saved arrangements.

Five distinct nonverbal sounds are synthesized as original PCM buffers in Web Audio. Imported and recorded material is decoded into the same buffer registry. There is no remote processing, interpretation, recommendation, or generation in response to marks.

Each material has a larger, softly shaded area and a small center handle. The outer area accepts drawing; grab the center to rearrange a sound.

Pointer events support mouse, pen and touch. Circle entry is tested against each complete movement segment so sparse pointer samples still detect fast crossings in spatial order. Timing is interpolated between gesture samples. Stationary samples and the gesture duration retain pauses. Each completed path stores its sound IDs and trigger times independently of circle positions. Replay schedules those original events and their recorded gain envelopes directly on the audio clock. Previously saved paths without envelopes retain their original constant-volume playback. Moving circles or resizing the canvas does not reinterpret earlier listening gestures.

Paths and positions scale with the canvas. Edge circles remain reachable on small screens. An interrupted pointer gesture is discarded; completed marks remain. Playback stops when the page is hidden. Recording tracks are released on stop, error, or teardown.

Work in a new, unnamed sketch stays in memory until saved or until switching projects triggers a checkpoint. Saved projects update locally; shared snapshots are uploaded only when Share is chosen. There are no accounts, analytics, or automatic server uploads.

## Projects

The folder icon opens the project menu. Save gives the current sketch a name in this browser's project library; Open switches to an existing project; New starts a fresh canvas. Sounds, original audio files, circle positions, all marks, timing, selection, and undo history are retained. Once a project has been saved, edits are saved locally after a short pause. Before switching projects or starting a new one, the current work is saved; if saving fails, the workspace remains open.

The plain app URL reopens the last saved local project. Opening a shared link creates an independent editable copy. Saving it as a project removes the share fragment from the editing address, and sharing a local project leaves that editing address unchanged, so refreshing returns to the latest local edits.

Projects are stored in IndexedDB on this browser and device. They are not account-synced and browser storage can be cleared or run out. Export creates a portable `.sonic` backup; Import opens that file as a separate project. Local saving is independent from sharing and does not use the previous 20 MB sharing cap. Project files support up to 2 GB, subject to browser memory and storage availability.

Each saved project has a trash icon. Deleting the open project starts a fresh canvas without saving it again. The most recently deleted project can be restored with Undo in the project menu during the current session. Deleting a local project does not revoke existing shared snapshots. Deletion removes its metadata and audio bundle from IndexedDB; one deleted bundle remains temporarily in memory for Undo.

To inspect local storage, open browser developer tools → Application (or Storage) → IndexedDB → `sonic-sketchbook-projects`. The `contents` store holds the binary project bundles, `projects` holds names and dates, and `settings` holds the last-opened project. This database belongs to `https://ziheng-lyu.github.io` and lives in the current browser profile, not a normal audio folder. Export provides a user-accessible backup file.

## Performance

Completed path coordinates are memoized so circle dragging does not rebuild all earlier SVG marks. Live path rendering is limited to animation frames; all input samples and sound crossing times are still retained. Autosave waits until the active gesture ends. Immutable audio Blob parts are reused across saves, avoiding repeated full copies of unchanged source files. Large or long audio still requires decoding and decoded playback memory; supported file limits are not a performance guarantee.

## Saved links

The frontend remains on GitHub Pages. The small storage service in `sharing-service/` runs separately with an R2 bucket. Project bundles keep original audio as raw binary bytes, avoiding base64 overhead. Sketch metadata is compressed separately. Sharing encrypts the bundle with a fresh AES-256-GCM key in independent chunks of at most 8 MB, then publishes an encrypted manifest only after every chunk is present. Only encrypted bytes are uploaded. The key lives in the link's URL fragment and is never sent to the storage service. Treat the complete link as access to the sketch: anyone you give it to can open the sounds and marks.

Snapshots are immutable and do not expire automatically. Sharing a later version does not change earlier links. New shares support up to 250 MB per project. Each upload is bounded to 8 MB plus encryption overhead, and grants last 30 minutes. Exceeding the sharing limit leaves the project intact and still allows local saving or export. The previous single-object share format remains readable; new links use the `#s2=` format. Grants cannot overwrite or delete a completed shared snapshot. The API exposes no listing of saved sketches.

For local integration testing, run `node tests/storage-server.mjs` in one terminal, then `VITE_SHARE_API=http://127.0.0.1:4177 npm run dev` in another. Test storage is in memory and disappears when that server stops. The production API URL is in `src/share.js`; it contains no credentials.

## Verification

`npm test` runs 39 checks covering crossing geometry, timing, selection, undo, distinct PCM buffers, replay scheduling, decoded audio, microphone lifecycle, encrypted snapshot round trips, cross-client reopening, retained undo, upload authorization, immutable saves, malformed links, proximity gain, fast passages, and retained volume envelopes.

With the dev server running, open `/tests/browser.html` and click **Run browser checks**. The development-only page exercises the actual React event handlers, Web Audio buffers and clock, real WAV decoding, and real MediaRecorder encoding/decoding from a controlled audio stream. It checks touch event handling, importing, recording, permission denial, failed imports, and responsive layouts. It also measures real audio signal levels at the edge and center of a sound field, checks continuous retreat to silence, and verifies that replay retains the volume contour. The full browser suite covers 63 checks, including project save/open/new, automatic local saves, refresh recovery, import/export, storage-quota recovery, project deletion and recovery, deferring autosave during gestures, and an actual WAV file larger than 20 MB that is saved, shared, and reopened. The local integration service keeps test uploads off production. The automated tests also exercise a 26 MB chunked share and backward compatibility for older links. The test page is excluded from the production build. Native browser gestures also verified circle audition, dragging, multiple paths, selection, and replay controls.

Microphone integration is verified with a controlled stream. Physical microphone hardware and a separate physical touch device have not been tested.
