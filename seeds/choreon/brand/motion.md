# Choreon — motion rules ("frame-perfect")

`DESIGN.md` defines the palette, the type and the logo; this file says how Choreon moves. `brand/house-rules.md` adds the project's bans and permissions.

## Stance

**Frame-perfect.** Choreon is spectacular through precision and rhythm, not softness: every cut lands on a beat, every element snaps to the grid, every number ticks at the frame rate. Where Sorbet melts and splats, Choreon cuts and locks. Think title sequence of a film about editors.

## Direction

- **Tempo**: locked to the music (≈ 110–124 BPM). Hard cut or a decisive event on beats; something changes at least every 1–2 beats in the build, then one held beat before each turn.
- **The editing suite as visual language**: timeline tracks, a `cue` playhead sweeping, keyframe diamonds, contact sheets and film strips, beat grids, timecode and frame counters in Geist Mono ticking frame by frame (`00:00:04:12`), scores counting up, annotation boxes in `signal`.
- **Scale extremes**: from a single keyframe diamond full frame to the whole timeline in one move; from one frame of a contact sheet to the full sheet.
- **Grid and inversion**: layouts snap to a visible grid; night ↔ paper full-frame inversions on hard cuts; split screens (2, 3, 4 panels) that each run their own frame.
- **Transitions are edits**: hard cuts on the beat, whip pans with heavy motion blur, match cuts (a diamond becomes the playhead becomes the `o`), a frame of the contact sheet zooming in to become the next shot.
- **Camera**: fast push-ins and pull-outs on `outExpo`, whip pans, a strict 2D plane by default; one 3D tilt of the timeline at most per film.

## Physics

- **Critical springs by default** (`springs.snappy`, `springs.default`, `springs.heavy`) and `outExpo` / `outQuint` tweens: fast, decisive, no wobble.
- **One exception**: `springs.pop` for keyframe "hits" — a diamond landing on its beat, the `key` of the logo locking in. Nothing else overshoots.
- No jelly, no squash and stretch, no bounce on text or panels.

## Type in motion

- Geist Bold **huge**: 240–600 px in 1080p, cropped by the frame, tracking −0.04 em; words cut in on the beat (hard cut or a mask wipe in 2–4 frames), never a fade.
- Geist Mono for every number: counters run at the frame rate, timecodes always correct for the instant shown.
- Instrument Serif Italic for one to three words of contrast per film ("you *direct*").
- Reading time: at least 0.35 s per word + 0.5 s for lines that carry the message.

## The real product

Choreon's films show Choreon: the brief, the framing questions, the storyboard cards with their beat map, `scene.html` code, the contact sheet, the critic's scores and annotation boxes, the timeline, the final player. Rebuild them as components (UI kit from the real app) — simplified, never invented.

## Logo

Built from its layers in `brand/logo/*.svg`. Signature arrival: the two ghost frames flash in on two beats (hard cuts, no motion), the `key` diamond lands on the third with `springs.pop`, the wordmark cuts in letter by letter on 16th notes, then everything locks. The final lockup is still, centred, held ≥ 1.5 s, with the tagline "You direct. Choreon animates." in Geist Medium.

## Don'ts

Fades and cross-dissolves · wobble, jelly, bouncy text · gradients, glow, lens flares, RGB split · floating particles · robots, brains, sparkles · invented features · slow "corporate" pans over empty space.
