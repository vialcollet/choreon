// Choreon runtime — loaded by each shot (`scene.html`) via `/engine/motion.js`.
//
// Render contract: a scene is a pure function of time. `window.seek(t)` paints
// the frame at instant t (seconds); no timer, no CSS transition, no
// unseeded Math.random. The renderer calls seek() in any order.

// ---------- maths ----------

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
/** Progress 0→1 of t between t0 and t1 (clamped). */
export const progress = (t, t0, t1) => (t1 === t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));

/** CSS cubic Bézier (x1, y1, x2, y2) → function 0..1 → 0..1. */
export function bezier(x1, y1, x2, y2) {
	const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
	const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
	const sx = (u) => ((ax * u + bx) * u + cx) * u;
	const sy = (u) => ((ay * u + by) * u + cy) * u;
	const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
	return (x) => {
		if (x <= 0) return 0;
		if (x >= 1) return 1;
		let u = x;
		for (let i = 0; i < 8; i++) {
			const e = sx(u) - x;
			if (Math.abs(e) < 1e-6) break;
			const d = dx(u);
			if (Math.abs(d) < 1e-6) break;
			u -= e / d;
		}
		return sy(clamp(u));
	};
}

export const ease = {
	linear: (x) => clamp(x),
	outCubic: bezier(0.33, 1, 0.68, 1),
	outQuart: bezier(0.25, 1, 0.5, 1),
	outQuint: bezier(0.22, 1, 0.36, 1),
	outExpo: bezier(0.16, 1, 0.3, 1),
	inCubic: bezier(0.32, 0, 0.67, 0),
	inOutCubic: bezier(0.65, 0, 0.35, 1),
	inOutQuint: bezier(0.83, 0, 0.17, 1),
	inOutSine: bezier(0.37, 0, 0.63, 1),
	outSine: bezier(0.61, 1, 0.88, 1),
	inSine: bezier(0.12, 0, 0.39, 0)
};

/**
  * Closed-form damped spring, 0 → 1. Pure function of the time elapsed since the start.
  * damping ≥ 2·√stiffness = critical: no overshoot; below, the spring overshoots and wobbles.
 */
export function spring(dt, { stiffness = 170, damping = 26 } = {}) {
	if (dt <= 0) return 0;
	const w0 = Math.sqrt(stiffness);
	const z = damping / (2 * w0);
	if (z < 1) {
		const wd = w0 * Math.sqrt(1 - z * z);
		return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + ((z * w0) / wd) * Math.sin(wd * dt));
	}
	return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt);
}

/**
  * Presets. Critical (zero overshoot): ui (snappy interface response), snappy, default, heavy, gentle.
  * Underdamped, for doctrines that allow it: pop (≈ 15 % overshoot), bouncy (≈ 30 %), jelly (≈ 50 %, wobbles, settles in ≈ 1 s).
 */
export const springs = {
	ui: { stiffness: 320, damping: 35.8 },
	snappy: { stiffness: 400, damping: 40 },
	default: { stiffness: 170, damping: 26.1 },
	heavy: { stiffness: 90, damping: 19 },
	gentle: { stiffness: 50, damping: 14.2 },
	pop: { stiffness: 300, damping: 18.5 },
	bouncy: { stiffness: 260, damping: 11.6 },
	jelly: { stiffness: 220, damping: 6.5 }
};

/**
  * Value with several successive targets: one spring component per change,
  * each starting at its own instant. Continuous, and computable at any t without
  * simulating the past. keys: [[t, value], ...] sorted by t.
 */
export function track(t, keys, opts = springs.default) {
	let v = keys[0][1];
	for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], opts);
	return v;
}

/**
  * Keyframes with per-segment easing: [[t, value, easeName?], ...]. A key's easing
  * applies to the segment leaving it. Values can be numbers or arrays.
 */
export function tween(t, keys) {
	if (t <= keys[0][0]) return keys[0][1];
	for (let i = 0; i < keys.length - 1; i++) {
		const [t0, v0, e = 'outExpo'] = keys[i];
		const [t1, v1] = keys[i + 1];
		if (t < t1) {
			const k = (typeof e === 'function' ? e : ease[e])(progress(t, t0, t1));
			return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], k)) : lerp(v0, v1, k);
		}
	}
	return keys[keys.length - 1][1];
}

/** Seeded noise (mulberry32): same render on every pass. */
export function rng(seed = 1) {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let x = Math.imul(s ^ (s >>> 15), 1 | s);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

/** Time (s) of a musical beat: beat(n, bpm, offset). */
export const beat = (n, bpm = 120, offset = 0) => offset + (n * 60) / bpm;

// ---------- ressources ----------

const imageCache = new Map();
export function loadImage(src) {
	if (!imageCache.has(src)) {
		imageCache.set(
			src,
			new Promise((res, rej) => {
				const img = new Image();
				img.onload = () => res(img);
				img.onerror = () => rej(new Error(`image not found: ${src}`));
				img.src = src;
			})
		);
	}
	return imageCache.get(src);
}

/** Project identity (`/project/brand/brand.json`): colors, fonts, logo. */
export async function loadBrand() {
	try {
		const r = await fetch('/project/brand/brand.json');
		if (r.ok) return await r.json();
	} catch {}
	return { colors: {}, fonts: {} };
}

/** Registers the fonts declared in brand.fontFiles ({family: {weight: url}}). */
export async function loadBrandFonts(brand) {
	const files = brand?.fontFiles || {};
	const jobs = [];
	for (const [family, weights] of Object.entries(files)) {
		for (const [weight, url] of Object.entries(weights)) {
			const face = new FontFace(family, `url(${url})`, { weight: String(weight) });
			jobs.push(face.load().then((f) => document.fonts.add(f)).catch(() => {}));
		}
	}
	await Promise.all(jobs);
}

/**
  * Interface kit harvested from a site (library/ui/<kit>, studio "Interface" page): components
  * rebuilt as layered vector SVG. Variants: 'fidele' (all text), 'simplifie'
  * (paragraphs as bars); defaults to the one recommended for each component.
 *   const ui = await loadUiKit('my-app');
 *   ui.draw(g, 'bouton-principal', x, y, { scale: 1.5, anchor: 'center' });   // canvas
 *   el.innerHTML = await ui.svg('carte-tache');                                 // DOM : calques animables (#fond, #t0…)
 */
export async function loadUiKit(slug, { variant } = {}) {
	const base = `/project/library/ui/${slug}/`;
	const kit = await (await fetch(base + 'kit.json')).json();
	const fileOf = (c, v) => base + c.files[v ?? variant ?? c.variant];
	const imgs = {};
	await Promise.all(kit.components.map(async (c) => (imgs[c.name] = await loadImage(fileOf(c)))));
	const get = (name) => {
		const c = kit.components.find((x) => x.name === name);
		if (!c) throw new Error(`unknown component: ${name} (kit ${slug}: ${kit.components.map((x) => x.name).join(', ')})`);
		return c;
	};
	return {
		...kit,
		get,
		/** Preloaded image of a component in the kit's variant. */
		image: (name) => (get(name), imgs[name]),
		/** SVG text of a component, to insert in the DOM and animate its layers. */
		svg: async (name, v) => (await fetch(fileOf(get(name), v))).text(),
		/** Draws a component at its original size × scale; anchor 'topleft' (default) or 'center'. */
		draw(g, name, x, y, { scale = 1, alpha = 1, anchor = 'topleft' } = {}) {
			const c = get(name), w = c.w * scale, h = c.h * scale;
			const [dx, dy] = anchor === 'center' ? [x - w / 2, y - h / 2] : [x, y];
			g.save();
			g.globalAlpha *= alpha;
			g.drawImage(imgs[name], dx, dy, w, h);
			g.restore();
			return { x: dx, y: dy, w, h };
		}
	};
}

/**
  * Layered logo (brand.logo): loads each SVG layer and returns a drawing object.
  * `unit` = pixels per viewBox unit. `draw(g, name, {dx, dy, scale, alpha})` draws a
  * layer shifted by (dx, dy) units and scaled around its own center.
 */
export async function loadLogo(brand, { unit = 1, origin = [0, 0] } = {}) {
	const L = brand.logo;
	const imgs = {};
	await Promise.all(L.order.map(async (n) => (imgs[n] = await loadImage(L.files[n]))));
	const [vw, vh] = L.viewBox;
	const api = {
		unit,
		origin,
		layers: L.layers,
		order: L.order,
		/** Screen position of a viewBox point. */
		toScreen: (x, y) => [origin[0] + x * unit, origin[1] + y * unit],
		draw(g, name, { dx = 0, dy = 0, scale = 1, alpha = 1 } = {}) {
			if (alpha <= 0 || scale <= 0) return;
			const [cx, cy] = L.layers[name].center;
			g.save();
			g.globalAlpha *= alpha;
			g.translate(origin[0] + (cx + dx) * unit, origin[1] + (cy + dy) * unit);
			g.scale(scale, scale);
			g.translate(-cx * unit, -cy * unit);
			g.drawImage(imgs[name], 0, 0, vw * unit, vh * unit);
			g.restore();
		}
	};
	return api;
}

// ---------- dessin ----------

export function roundRect(g, x, y, w, h, r) {
	const rr = Math.min(r, w / 2, h / 2);
	g.beginPath();
	g.moveTo(x + rr, y);
	g.arcTo(x + w, y, x + w, y + h, rr);
	g.arcTo(x + w, y + h, x, y + h, rr);
	g.arcTo(x, y + h, x, y, rr);
	g.arcTo(x, y, x + w, y, rr);
	g.closePath();
}

/** Draws an image centered at (cx, cy) at scale s, with opacity and rotation. */
export function drawCentered(g, img, cx, cy, { scale = 1, alpha = 1, rotate = 0, width } = {}) {
	if (alpha <= 0 || scale <= 0) return;
	const w = (width ?? img.width) * scale;
	const h = (img.height / img.width) * w;
	g.save();
	g.globalAlpha *= alpha;
	g.translate(cx, cy);
	if (rotate) g.rotate(rotate);
	g.drawImage(img, -w / 2, -h / 2, w, h);
	g.restore();
}

/** Text with letter-spacing (em). align: left | center | right. */
export function text(g, str, x, y, { font, color, align = 'left', tracking = 0, alpha = 1, baseline = 'alphabetic' } = {}) {
	if (alpha <= 0) return;
	g.save();
	g.globalAlpha *= alpha;
	if (font) g.font = font;
	if (color) g.fillStyle = color;
	g.textBaseline = baseline;
	if ('letterSpacing' in g) {
		const px = parseFloat(g.font) || 16;
		g.letterSpacing = `${tracking * px}px`;
		g.textAlign = align;
		g.fillText(str, x, y);
	} else {
		g.textAlign = align;
		g.fillText(str, x, y);
	}
	g.restore();
}

// ---------- scene ----------

/**
  * Declares the scene. options:
 *  - width, height, duration (s), fps, background
  *  - mode: 'canvas' (default) or 'dom' (the scene animates the DOM; the renderer captures the page)
  *  - setup(ctx): async, loads resources; ctx = { brand, canvas, g, root }
 *  - draw(g, t, ctx) : peint l'instant t
 */
export function scene(opts) {
	const { width = 1920, height = 1080, duration = 5, fps = 30, background = '#f9fafc', mode = 'canvas' } = opts;
	const scale = Number(new URLSearchParams(location.search).get('scale') || window.__SCALE || 1);
	document.documentElement.style.background = background;
	document.body.style.margin = '0';
	document.body.style.background = background;
	document.body.style.overflow = 'hidden';

	let canvas = null, g = null;
	const root = document.getElementById('root') || document.body;
	if (mode === 'canvas') {
		canvas = document.createElement('canvas');
		canvas.id = 'stage';
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		canvas.style.display = 'block';
		document.body.appendChild(canvas);
		g = canvas.getContext('2d');
	}
	const ctx = { canvas, g, root, width, height, duration, fps, brand: null };

	const ready = (async () => {
		ctx.brand = await loadBrand();
		await loadBrandFonts(ctx.brand);
		await document.fonts.ready;
		if (opts.setup) await opts.setup(ctx);
		await document.fonts.ready;
	})();

	const paint = (t) => {
		if (g) {
			g.setTransform(scale, 0, 0, scale, 0, 0);
			g.globalAlpha = 1;
			g.fillStyle = background;
			g.fillRect(0, 0, width, height);
		}
		opts.draw(g, clamp(t, 0, duration), ctx);
	};

	window.SCENE = { width, height, duration, fps, mode, scale };
	window.DURATION = duration;
	window.seek = async (t) => {
		await ready;
		paint(t);
		return true;
	};

	// In-page motion blur (canvas mode): sliding average of n sub-frames
	// spread over `span` seconds, accumulated on an offscreen canvas, then copied back.
	// A single capture per frame instead of n.
	let acc = null;
	window.seekBlur = async (t, n, span) => {
		await ready;
		if (!canvas || n <= 1) {
			paint(t);
			return true;
		}
		if (!acc) {
			acc = document.createElement('canvas');
			acc.width = canvas.width;
			acc.height = canvas.height;
		}
		const a = acc.getContext('2d');
		for (let k = 0; k < n; k++) {
			paint(t + (k / n) * span);
			a.globalAlpha = 1 / (k + 1);
			a.drawImage(canvas, 0, 0);
		}
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.globalAlpha = 1;
		g.drawImage(acc, 0, 0);
		return true;
	};

	// Live preview in a regular browser (never during headless rendering).
	const q = new URLSearchParams(location.search);
	if (!navigator.webdriver && q.get('preview') !== '0') {
		ready.then(() => {
			if (q.has('t')) return paint(Number(q.get('t')));
			const t0 = performance.now();
			const loop = () => {
				paint(((performance.now() - t0) / 1000) % duration);
				requestAnimationFrame(loop);
			};
			loop();
		});
	}
	return ctx;
}
