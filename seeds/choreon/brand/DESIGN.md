# Choreon — design language

**Choreon — you direct, Choreon animates.** An open-source motion design studio run by AI agents: brief → storyboard → shots coded frame by frame → critique → edit → sound. This project is the studio filming itself: its films show the real product.

## Personality

Precise, kinetic, a little cocky. The editing suite at night: dark room, one hot light, every frame accounted for. Choreon never says "magic"; it shows the work — the beat map, the keyframes, the critique, the cut.

## Colour

| Token | Hex | Use |
|---|---|---|
| `night` | `#0c0c0c` | Default background. The editing suite. |
| `panel` | `#151515` | Surfaces, cards, panels on night. |
| `graphite` | `#1e1e1d` | Raised surfaces, inputs, timeline tracks. |
| `line` | `#2c2b28` | 1 px borders, grid lines, frame dividers (2 px in video). |
| `mist` | `#a3a19a` | Secondary text, timecodes, labels. |
| `paper` | `#f4f1e8` | Text on night; full-frame inversions. |
| `cue` | `#ffd400` | Slate yellow, the hero accent: the keyframe, the playhead, the one thing to look at. Text on cue is `night`. |
| `jade` | `#3fcf8e` | Approved, passed, done. |
| `lilac` | `#b48cff` | To decide, waiting for the director. |
| `signal` | `#f0504a` | Error, a note on the frame (annotation boxes). |

Rules: flat colour only — no gradients, no glow, no neon, no drop shadows. One `cue` element per frame. `jade`, `lilac` and `signal` are states, never decoration.

## Type

- **Geist** — display and UI. SemiBold (600) / Bold (700) for titles, tight tracking (−0.035 em); Regular (400) and Medium (500) for UI text. Lowercase is the brand's voice.
- **Geist Mono** — timecodes, frame counters, scores, code. Tabular, Regular (400) or Medium (500), tracking 0.
- **Instrument Serif Italic** — the editorial accent: one to three words per film or page ("frame by *frame*"). Never for UI, never a full line.

## Shapes

- Radius: 8 px panels, 6 px controls, 999 px chips. Keyframes are diamonds (squares at 45°, slightly rounded).
- A visible grid: layouts snap to columns and frame-sized cells; 1 px `line` dividers.
- Icons: 1.75 px strokes, rounded caps, `paper` or `mist`.

## Logo

The **keyframe trail**: three diamonds on a rising ease-out arc — two ghost frames (`#3a3933`, `#6d6b63`) and the key in `cue` — then the lowercase wordmark **choreon** in Geist SemiBold. Layers in `logo/`: `ghost_1`, `ghost_2`, `key`, `l_c`, `l_h`, `l_o`, `l_r`, `l_e`, `l_o2`, `l_n`. The diamonds are always solid (no transparency, no outline). On paper backgrounds the wordmark turns night and the ghosts lighten (`#c3cad4`, `#a3a19a`): `logo-choreon-light.svg`.

## Don'ts

No gradients · no glow or neon · no drop shadows · no stock "AI" imagery (brains, sparkles, robots, circuits) · no invented features or fake UI · no emoji.
