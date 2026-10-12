import type { Project } from './store';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ENGINE_DIR } from './paths';
import { listKits } from './uikit';

const read = (f: string) => {
	try {
		return readFileSync(f, 'utf8');
	} catch {
		return '';
	}
};

/** Studio rules (engine/house-rules.md): craft that holds for every style, no taste. */
export const studioRules = () => read(join(ENGINE_DIR, 'house-rules.md'));

/** The project's own rules (brand/house-rules.md): its bans and permissions, on top of the studio's. */
export const projectRules = (pid: string) => read(join(DATA_DIR, 'projects', pid, 'brand', 'house-rules.md'));

/** True when the project has rules of its own. */
export const ownHouseRules = (pid: string) => existsSync(join(DATA_DIR, 'projects', pid, 'brand', 'house-rules.md'));

/** The logo's layer ids and viewBox (brand.json), for the code examples. */
function logoInfo(pid: string): { layers: string[]; viewBox: string } {
	try {
		const logo = JSON.parse(read(join(DATA_DIR, 'projects', pid, 'brand', 'brand.json')))?.logo ?? {};
		const vb = Array.isArray(logo.viewBox) ? logo.viewBox.join('×') : '1000×300';
		return { layers: logo.order ?? Object.keys(logo.layers ?? {}), viewBox: vb };
	} catch {
		return { layers: [], viewBox: '1000×300' };
	}
}

const fwd = (p: string) => p.split('\\').join('/');

/** The project's UI kits, so agents rebuild the real UI instead of making it up. */
function kitsBlock(pid: string): string {
	const kits = listKits(pid);
	if (!kits.length) return '';
	return `\n### Available UI kits (\`library/ui/<kit>/kit.json\`)\nWhen a shot shows the interface of one of these products, compose it from its components (recognizable, already simplified) rather than redrawing it.\n${kits
		.map((k) => `- **${k.slug}** — ${k.label} (${k.url}): ${k.components.map((c) => `\`${c.name}\` (${c.label}, ${c.w}×${c.h})`).join(', ')}`)
		.join('\n')}\n`;
}

/** The brand's display font family (brand.json), used in the code examples. */
function displayFamily(pid: string): string {
	try {
		const b = JSON.parse(readFileSync(join(DATA_DIR, 'projects', pid, 'brand', 'brand.json'), 'utf8'));
		return b?.fonts?.display?.family || 'sans-serif';
	} catch {
		return 'sans-serif';
	}
}

/**
 * CLAUDE.md of the project workspace: the house rules, read automatically by every
 * agent (cwd = project folder). Regenerated on every settings change.
 */
export function workspaceClaudeMd(p: Project): string {
	const E = fwd(ENGINE_DIR);
	const font = displayFamily(p.id);
	const logo = logoInfo(p.id);
	const own = projectRules(p.id);
	const axes = p.settings.eval.axes.map((a) => `- **${a.label}** (${a.key}, threshold ${a.threshold}/10) — ${a.description}`).join('\n');
	return `# Choreon — project "${p.name}"

You are working in the project's video production workspace. Every film is **code rendered frame by frame**: you write shots (\`scene.html\`), the engine renders them to MP4. You are director, animator and art director at once: demanding, precise, never generic.

## Tree

- \`brand/\` — identity: \`motion.md\` (motion rules, READ BEFORE ANYTHING ELSE), \`DESIGN.md\` (brand guidelines), \`brand.json\` (colors, fonts, logo as SVG layers), \`logo/\`, \`fonts/\`
- \`library/\` — the project's asset library (images, svg, html, sounds, videos)
- \`videos/<video>/storyboard/\` — storyboards (\`draft.json\`) and reference images (\`refs/\`)
- \`videos/<video>/shots/<shot>/scene.html\` — one shot = one scene; its renders are managed by the studio

## Render contract (non-negotiable)

- A scene is a **pure function of time**: \`window.seek(t)\` paints instant t. No \`setTimeout\`, \`requestAnimationFrame\`, CSS transition/animation, \`Date.now\`, nor unseeded \`Math.random\` (use \`rng(seed)\`).
- Always start from the runtime: \`import { scene, tween, spring, springs, track, ease, progress, rng, beat, loadImage, loadLogo, loadUiKit, drawCentered, text, roundRect } from '/engine/motion.js'\`.
- \`scene({ width, height, duration, fps, background, mode: 'canvas'|'dom', setup(ctx), draw(g, t, ctx) })\`. \`ctx.brand\` holds \`brand.json\` (colors in \`ctx.brand.colors\`); the project fonts are already loaded.
- URLs served during rendering: \`/engine/*\` (runtime), \`/project/*\` (this folder: \`/project/brand/...\`, \`/project/library/...\`), \`/scene/*\` (the shot folder).
- Logo: \`const logo = await loadLogo(ctx.brand, { unit, origin })\` then \`logo.draw(g, ${logo.layers.map((l) => `'${l}'`).join(' | ') || "'<layer>'"}, { dx, dy, scale, alpha })\` (units of the ${logo.viewBox} viewBox). Use the layers as designed (\`brand/DESIGN.md\`).
- Motion: physics and easing follow \`brand/motion.md\`. Presets \`springs.ui|snappy|default|heavy|gentle\` are critically damped (zero overshoot); \`springs.pop|bouncy|jelly\` overshoot (≈ 15 %, 30 %, 50 % with wobble) — only where the doctrine allows it. Or \`tween\` with an easing. A value with several targets = \`track()\`.

## Runtime API (\`/engine/motion.js\`) — no need to read the file

- \`scene(opts)\` → ctx \`{ canvas, g, root, width, height, duration, fps, brand }\`; \`draw(g, t, ctx)\` receives a canvas already cleared with \`background\`.
- \`tween(t, [[t0, v0, 'outExpo'], [t1, v1, 'inOutCubic'], [t2, v2]])\` → value (number or array); a key's easing applies to the segment leaving it. Easings: \`linear outCubic outQuart outQuint outExpo inCubic inOutCubic inOutQuint inOutSine outSine inSine\` (also \`ease.outExpo(x)\`, \`bezier(x1,y1,x2,y2)\`).
- \`spring(dt, springs.default)\` → 0..1 (dt = time since start; 0 if dt ≤ 0). Critical presets \`springs.ui\`, \`snappy\`, \`default\`, \`heavy\`, \`gentle\` (zero overshoot); underdamped \`springs.pop\`, \`bouncy\`, \`jelly\`; or any \`{ stiffness, damping }\` (damping < 2·√stiffness overshoots).
- \`track(t, [[t0, v0], [t1, v1], …], springs.default)\` → continuous value with several targets.
- \`progress(t, t0, t1)\` → clamped 0..1 · \`clamp\`, \`lerp(a, b, k)\` · \`rng(seed)\` → () => 0..1 · \`beat(n, bpm, offset)\` → seconds.
- \`await loadImage(url)\` · \`drawCentered(g, img, cx, cy, { scale, alpha, rotate, width })\`.
- \`text(g, str, x, y, { font: '700 72px ${font}', color, align: 'left'|'center'|'right', tracking: -0.02, alpha, baseline })\`.
- \`roundRect(g, x, y, w, h, r)\` (traces the path; then \`g.fill()\` / \`g.stroke()\`).
- \`await loadLogo(ctx.brand, { unit, origin: [x, y] })\` → \`logo.draw(g, layer, { dx, dy, scale, alpha })\`, \`logo.toScreen(x, y)\`, \`logo.layers[layer].center\`.
- \`'dom'\` mode: \`draw(null, t, ctx)\` updates the DOM of \`ctx.root\` (styles computed from t, never CSS transitions); useful for complex text layout.
- \`await loadUiKit(kit)\` → \`ui.draw(g, name, x, y, { scale, alpha, anchor: 'center' })\` (canvas), \`await ui.svg(name)\` (SVG text to insert into the DOM to animate its layers \`#fond\`, \`#p0…\`, \`#t0…\`), \`ui.get(name)\` (size, role), \`ui.tokens\` (the site's colors, fonts, radii).
${kitsBlock(p.id)}

## Commands

- Still-frame preview (ALWAYS check your shots by looking at them):
  \`node "${E}/render.mjs" --scene <shot folder> --project . --stills 0.5,1.5,3 --stills-dir <folder>/_check --scale 0.5\`
  then read the PNGs it produces.
- Video render (the studio does it itself after your task; useful for a short test):
  \`node "${E}/render.mjs" --scene <folder> --project . --out <folder>/_check/test.mp4 --from 0 --to 2 --scale 0.5\`
- Codex-generated image (illustrations, textures, photos):
  \`node "${E}/codex-image.mjs" --prompt "..." --out library/<name>.png\` (≈ 30 s; specify palette and style).

${studioRules().replace(/^## /gm, '### ').replace(/^# /, '## ')}
${own ? `
${own.replace(/^# .*$/m, '## Project rules (brand/house-rules.md) — on top of the studio rules; they settle every question of taste').replace(/^## (?!Project rules)/gm, '### ')}
` : ''}

## Studio memory

Before working, read \`brand/lessons.md\` (this project's lessons) and \`${fwd(DATA_DIR)}/lessons.md\` (studio lessons). These are mistakes already made and corrected: do not repeat them. They override your habits; tasks also remind you of them in their instructions (numbers L…).

## Look

Read \`brand/motion.md\`: the project's doctrine decides the look — physics, transitions, density, pace, texture. Apply it fully: a calm doctrine wants calm done perfectly, a loud one wants spectacle done perfectly. ${own ? 'The project rules above win over any studio lesson or habit that contradicts them.' : 'This project has no rules of its own beyond the doctrine.'} One strong visual idea per shot.

## Project evaluation grid

Every render is scored by a critic on these axes:

${axes}

## Discipline

- Only modify the files of the requested task. A surgical touch-up changes the minimum.
- No external dependency (no CDN): everything comes from \`/engine\`, \`/project\` or the shot folder.
- End every task with a short report: what you did, what you checked, what remains doubtful.
`;
}
