# Sorbet — motion rules

Translation of `DESIGN.md` for video. DESIGN.md stays the reference for colours, type and don'ts; this file says what changes when things move.

## Stance

**Juicy, precise, never sloppy.** Sorbet's energy comes from colour, scale and rhythm — not from wobble. Every move has a job: scoop (group), stack (prioritise), pour (reveal), clear (finish).

## Direction

- **Brisk rhythm**: an event every 1.5–3 s. Social cuts can go faster; the final frame always holds ≥ 1.5 s.
- **One element, never cut**: a card becomes a scoop, a scoop becomes the logo. Transitions are carried by an element (a circle that grows into the next scene, a card that zooms into its content), not by cuts or crossfades.
- **Zero overshoot**: critical springs only. "Juicy" means fast-in, soft landing (`outExpo`, `outQuint`), not bounce.
- **Cursor and sound are the narrators**: a plum_ink cursor drives every UI action; each action and each state change has its sound.

## Surfaces

- Default background **cream `#fff7ee`**; dark scenes use **plum_night `#120e22`** — night → cream is the "relief" moment.
- Cards: milk on cream, 16 px radius, 2 px wafer border. No shadows: depth comes from scale and overlap.
- One hero accent per frame. The three scoop colours together = the brand moment.

## Type in motion

- Titles: Bricolage Grotesque ExtraBold, 80–120 px in 1080p, tracking −0.03 em, enter by mask or a short rise (≤ 24 px) on a critical spring; never letter-by-letter beyond a single word.
- UI text: Inter 500, 18–24 px in 1080p.
- Reading time: at least 0.35 s per word + 0.5 s.

## Motion vocabulary

- `springs.snappy` for UI (buttons, chips, cursor), `springs.default` for cards, `springs.heavy` for the logo and big titles.
- **Scoop**: three items gather into three solid circles (mint, mango, raspberry) — the signature move.
- **Pour**: a colour fills a shape from the bottom, like a scoop being served.
- Camera: gentle push-ins (≤ 8 %) with `inOutCubic`; no shake, no rotation.

## Logo

Built from its layers in `brand/logo/*.svg`. Signature arrival ("Three scoops"): the three scoops drop in one by one (mint, mango, raspberry) with soft landings, then the wordmark slides out from behind the raspberry scoop. The scoops are always solid.

## Don'ts (on top of DESIGN.md)

Bouncy springs · everything fading in · centred title on an empty gradient · particles · sparkles or "AI" effects · more than one accent per frame · copy like "10x", "Powered by AI", "The future of…".
