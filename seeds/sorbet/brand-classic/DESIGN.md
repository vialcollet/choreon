# Sorbet — design language

> **Sorbet is a fictional brand** created to demo Choreon. It is not a real product.

**Sorbet — a sweeter way to plan your week.** A team planner that turns a messy week into three clear scoops: what matters, what's next, what can wait.

## Personality

Fresh, confident, a little cheeky. Sorbet never shouts: it delights with colour and timing, then gets out of the way. Think "dessert menu designed by a Swiss typographer".

## Colour

| Token | Hex | Use |
|---|---|---|
| `cream` | `#fff7ee` | Default background. Never pure white for large areas. |
| `milk` | `#ffffff` | Cards and surfaces on cream. |
| `wafer` | `#f1e6d8` | Borders, dividers, quiet fills (1 px UI, 2 px in video). |
| `plum_ink` | `#1c1530` | Text, icons, primary buttons. |
| `plum_soft` | `#6b6080` | Secondary text. |
| `plum_night` | `#120e22` | Dark mode background; night scenes. |
| `raspberry` | `#ff4f79` | The hero accent: the one thing to look at. |
| `mango` | `#ffb02e` | Energy: highlights, "today", progress. |
| `mint` | `#2fd3ae` | Done, success, calm. |
| `lilac` | `#b9a6ff` | Rare accent for AI suggestions. |

Rules: one hero accent per frame (usually raspberry). The three scoop colours appear together only in the logo and in the "week in three scoops" moment. Flat colour only — no gradients, no glow, no drop shadows.

## Type

- **Bricolage Grotesque** — display and headlines. ExtraBold (800) for titles, tight tracking (−0.03 em). Lowercase is welcome.
- **Inter** — UI text. Medium (500) for labels, Regular (400) for body.

## Shapes

- Radius: 16 px cards, 999 px pills, perfect circles for "scoops".
- Generous spacing; content floats on cream with 2 px wafer borders.
- Icons: 2 px rounded strokes, plum_ink.

## Logo

Three solid scoops (mint, mango, raspberry on top) and the lowercase wordmark **sorbet** in Bricolage Grotesque ExtraBold. Layers in `logo/`: `scoop_mint`, `scoop_mango`, `scoop_raspberry`, `l_s`, `l_o`, `l_r`, `l_b`, `l_e`, `l_t`. Scoops are always solid — never outlined, never transparent. On dark backgrounds the wordmark turns cream.

## Don'ts

No gradients · no glow or neon · no drop shadows · no stock "AI magic" (sparkles, brains, circuits) · no more than one accent fighting for attention · no emoji in the UI.
