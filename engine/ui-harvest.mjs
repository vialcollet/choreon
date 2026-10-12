#!/usr/bin/env node
// UI harvest: loads a site, spots its UI elements (navigation, fields, buttons,
// cards, tabs, badges, avatars, icons…) and rebuilds each as simplified vector SVG,
// split into layers, ready for motion design.
//
//   node engine/ui-harvest.mjs --url https://… --out <dossier> [--width 1440] [--height 900]
//        [--storage auth.json] [--max 90] [--wait 1500]
//
// Outputs: page.png (full page), overlay-<n>.png (numbered elements, per screen slice),
// candidates.json (role, text, geometry, styles), tokens.json (palette, fonts, radii),
// c/<id>.svg (text kept), c/<id>-bars.svg (long texts as bars), c/<id>.png (original capture).
// Simplification: short labels kept, paragraphs → rounded bars, photos → flat fills,
// shadows → thin border, SVG icons kept (recolored), no gradients.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : acc), []));
if (!a.url || !a.out) {
	console.error('usage : --url https://… --out <dossier>');
	process.exit(1);
}
const OUT = resolve(a.out);
mkdirSync(join(OUT, 'c'), { recursive: true });
const W = Number(a.width ?? 1440), H = Number(a.height ?? 900), MAX = Number(a.max ?? 90);

// ---------- code run in the page ----------
function extract(MAX) {
	const ROLES_TEXT = new Set(['button', 'input', 'search', 'select', 'badge', 'tab', 'tabs', 'nav', 'menu', 'heading', 'toggle', 'header', 'sidebar', 'logo', 'link', 'chip']);
	const px = document.createElement('canvas');
	px.width = px.height = 1;
	const pctx = px.getContext('2d', { willReadFrequently: true });
	const hexCache = new Map();
	/** Any CSS color → #rrggbb (or rgba if translucent), via a canvas pixel. */
	const hex = (c) => {
		if (!c || c === 'transparent') return 'transparent';
		if (hexCache.has(c)) return hexCache.get(c);
		pctx.clearRect(0, 0, 1, 1);
		pctx.fillStyle = '#000';
		pctx.fillStyle = c;
		pctx.fillRect(0, 0, 1, 1);
		const [r, g, b, al] = pctx.getImageData(0, 0, 1, 1).data;
		const v = al === 0 ? 'transparent' : al < 250 ? `rgba(${r},${g},${b},${(al / 255).toFixed(2)})` : '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
		hexCache.set(c, v);
		return v;
	};
	const transparent = (c) => hex(c) === 'transparent';
	const rect = (el) => el.getBoundingClientRect();
	const sx = window.scrollX, sy = window.scrollY;
	const abs = (r) => ({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
	const visible = (el) => {
		const r = rect(el);
		if (r.width < 4 || r.height < 4) return false;
		const cs = getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
	};
	const txt = (el) => (el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
	const hasBox = (cs) => !transparent(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || cs.boxShadow !== 'none';
	const radius = (cs) => parseFloat(cs.borderTopLeftRadius) || 0;

	function roleOf(el) {
		const tag = el.tagName.toLowerCase(), role = el.getAttribute('role') || '', cs = getComputedStyle(el), r = rect(el);
		const type = (el.getAttribute('type') || '').toLowerCase();
		const ph = (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '');
		if (tag === 'input' && ['checkbox', 'radio'].includes(type) || role === 'switch' || role === 'checkbox') return 'toggle';
		if (tag === 'input' && ['submit', 'button'].includes(type)) return 'button';
		if (tag === 'input' || tag === 'textarea' || role === 'searchbox' || role === 'textbox' || el.isContentEditable && el.parentElement && !el.parentElement.isContentEditable)
			return type === 'search' || /search|recherch|cherch/i.test(ph) ? 'search' : 'input';
		if (tag === 'select' || role === 'combobox' || role === 'listbox') return 'select';
		if (role === 'dialog' || tag === 'dialog') return 'modal';
		if (role === 'tablist') return 'tabs';
		if (role === 'tab') return 'tab';
		if (tag === 'table') return 'table';
		if (tag === 'header' || role === 'banner') return r.width > innerWidth * 0.6 && r.height < 160 ? 'header' : null;
		if (tag === 'aside' || (tag === 'nav' && r.height > r.width * 1.5)) return 'sidebar';
		if (tag === 'nav' || role === 'navigation' || role === 'menubar' || role === 'menu') return 'nav';
		// Menu entry (even without background): short link or button in a navigation or side menu.
		if ((tag === 'a' || tag === 'button' || role === 'menuitem' || role === 'link') && el.closest('nav,aside,[role=navigation],[role=menu]') && txt(el).length > 0 && txt(el).length < 40 && r.height >= 20 && r.height <= 60) return 'navitem';
		// Large framed clickable area (module tile, link card): it is a card, not a button.
		if ((tag === 'button' || tag === 'a' || role === 'button') && hasBox(cs) && r.width >= 160 && r.height >= 90 && txt(el).length > 0) return 'card';
		if (tag === 'button' || role === 'button' || (tag === 'a' && hasBox(cs) && txt(el).length > 0 && txt(el).length < 40 && r.height < 72)) return 'button';
		if (/^h[1-3]$/.test(tag) && txt(el).length > 0 && txt(el).length < 120) return 'heading';
		if ((tag === 'img' || tag === 'svg') && /logo/i.test((el.getAttribute('alt') || '') + (el.getAttribute('class') || '') + (el.closest('a')?.getAttribute('aria-label') || ''))) return 'logo';
		if (hasBox(cs) && r.width >= 28 && r.width <= 80 && Math.abs(r.width - r.height) < 4 && el.querySelector('svg,img') && !txt(el)) return 'icon';
		if ((tag === 'img' || tag === 'div' || tag === 'span') && r.width >= 20 && r.width <= 72 && Math.abs(r.width - r.height) < 3 && radius(cs) >= r.width * 0.4) return 'avatar';
		if (hasBox(cs) && r.height <= 34 && r.width <= 220 && txt(el).length > 0 && txt(el).length < 30 && radius(cs) >= 6) return 'badge';
		if (hasBox(cs) && radius(cs) >= 4 && r.width >= 140 && r.width <= innerWidth * 0.9 && r.height >= 60 && r.height <= 900 && txt(el).length > 0) return 'card';
		return null;
	}

	// ---------- simplified SVG reconstruction ----------
	const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const canvas = document.createElement('canvas').getContext('2d');
	const n2 = (v) => Math.round(v * 10) / 10;

	function svgFor(root, role, bars) {
		const R = rect(root);
		const parts = [];
		let id = 0;
		const keepText = ROLES_TEXT.has(role);
		const box = (el, cs, r, depth) => {
			const bg = transparent(cs.backgroundColor) ? 'none' : hex(cs.backgroundColor);
			const side = (k) => ({ w: cs[`border${k}Style`] === 'none' || transparent(cs[`border${k}Color`]) ? 0 : parseFloat(cs[`border${k}Width`]) || 0, c: hex(cs[`border${k}Color`]) });
			const S = { Top: side('Top'), Right: side('Right'), Bottom: side('Bottom'), Left: side('Left') };
			const sides = Object.values(S);
			const uniform = sides.every((x) => x.w === sides[0].w && (x.w === 0 || x.c === sides[0].c));
			// Isolated sides (row separators, hairlines): one stroke per present side, not a frame.
			if (!uniform) {
				const x0 = n2(r.left - R.left), y0 = n2(r.top - R.top), x1 = n2(r.right - R.left), y1 = n2(r.bottom - R.top);
				const seg = { Top: [x0, y0 + S.Top.w / 2, x1, y0 + S.Top.w / 2], Bottom: [x0, y1 - S.Bottom.w / 2, x1, y1 - S.Bottom.w / 2], Left: [x0 + S.Left.w / 2, y0, x0 + S.Left.w / 2, y1], Right: [x1 - S.Right.w / 2, y0, x1 - S.Right.w / 2, y1] };
				if (bg !== 'none') parts.push(`<rect id="${el === root ? 'fond' : 'p' + id++}" x="${x0}" y="${y0}" width="${n2(r.width)}" height="${n2(r.height)}" rx="${n2(Math.min(radius(cs), r.height / 2))}" fill="${bg}"/>`);
				for (const [k, v] of Object.entries(S)) if (v.w) parts.push(`<line id="b${id++}" x1="${n2(seg[k][0])}" y1="${n2(seg[k][1])}" x2="${n2(seg[k][2])}" y2="${n2(seg[k][3])}" stroke="${v.c}" stroke-width="${v.w}"/>`);
				return;
			}
			let bw = sides[0].w;
			let bc = bw ? sides[0].c : 'none';
			if (!bw && cs.boxShadow !== 'none' && bg !== 'none') { bw = 1; bc = 'rgba(15,23,42,0.12)'; } // ombre → bordure fine
			if (bg === 'none' && !bw) return;
			const rx = Math.min(radius(cs), r.height / 2, r.width / 2);
			parts.push(`<rect id="${el === root ? 'fond' : 'p' + id++}" x="${n2(r.left - R.left + bw / 2)}" y="${n2(r.top - R.top + bw / 2)}" width="${n2(Math.max(0, r.width - bw))}" height="${n2(Math.max(0, r.height - bw))}" rx="${n2(rx)}" fill="${bg}"${bw ? ` stroke="${bc}" stroke-width="${bw}"` : ''}/>`);
		};
		const textRun = (node, cs, short) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			const lines = [...range.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
			if (!lines.length) return;
			const fs = parseFloat(cs.fontSize);
			let str = node.textContent.replace(/\s+/g, ' ').trim();
			if (!str) return;
			// CSS uppercase / lowercase carried over into the rebuilt text.
			if (cs.textTransform === 'uppercase') str = str.toUpperCase();
			else if (cs.textTransform === 'lowercase') str = str.toLowerCase();
			else if (cs.textTransform === 'capitalize') str = str.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
			// Two levels: faithful = all the text; simplified = labels and titles, the rest as bars.
			const keep = !bars || short || str.length <= 28 || fs >= 20 || (keepText && str.length <= 40);
			canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
			if (keep) {
				// Split into lines as close as possible to the original rendering.
				const words = str.split(' ');
				let w = 0;
				const out = [];
				lines.forEach((q, li) => {
					let line = '';
					// The last line takes all the remaining words: a measure slightly wider than the
					// rendering (system font) must never cost a word.
					if (li === lines.length - 1) line = words.slice(w).join(' '), (w = words.length);
					else {
						while (w < words.length && canvas.measureText((line ? line + ' ' : '') + words[w]).width <= q.width + 4) line += (line ? ' ' : '') + words[w++];
						if (!line && w < words.length) line = words[w++];
					}
					if (line) out.push([q, line]);
				});
				for (const [q, line] of out)
					parts.push(`<text id="t${id++}" x="${n2(q.left - R.left)}" y="${n2(q.top - R.top + q.height * 0.78)}" font-family="${esc(cs.fontFamily)}, Inter, system-ui, sans-serif" font-size="${fs}" font-weight="${cs.fontWeight}" fill="${hex(cs.color)}"${cs.letterSpacing !== 'normal' ? ` letter-spacing="${cs.letterSpacing}"` : ''}>${esc(line)}</text>`);
			} else {
				for (const q of lines) {
					const h = Math.max(4, fs * 0.5);
					parts.push(`<rect id="t${id++}" x="${n2(q.left - R.left)}" y="${n2(q.top - R.top + (q.height - h) / 2)}" width="${n2(q.width)}" height="${n2(h)}" rx="${n2(h / 2)}" fill="${hex(cs.color)}" fill-opacity="0.28"/>`);
				}
			}
		};
		const walk = (el, depth) => {
			if (depth > 14 || !visible(el)) return;
			const cs = getComputedStyle(el), r = rect(el), tag = el.tagName.toLowerCase();
			if (r.right < R.left || r.left > R.right || r.bottom < R.top || r.top > R.bottom) return;
			if (tag === 'svg') {
				const c = el.cloneNode(true);
				c.removeAttribute('class');
				c.setAttribute('x', n2(r.left - R.left));
				c.setAttribute('y', n2(r.top - R.top));
				c.setAttribute('width', n2(r.width));
				c.setAttribute('height', n2(r.height));
				c.setAttribute('id', 'i' + id++);
				let s = c.outerHTML.replace(/currentColor/g, hex(cs.color));
				if (!/fill=|stroke=/.test(s.slice(0, 200)) && !/viewBox/.test(s)) s = s.replace('<svg', `<svg fill="${hex(cs.color)}"`);
				if (s.length < 8000) parts.push(s);
				return;
			}
			if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture') {
				const small = r.width <= 48 && r.height <= 48;
				const round = radius(cs) >= Math.min(r.width, r.height) * 0.4;
				parts.push(round
					? `<circle id="m${id++}" cx="${n2(r.left - R.left + r.width / 2)}" cy="${n2(r.top - R.top + r.height / 2)}" r="${n2(Math.min(r.width, r.height) / 2)}" fill="${small ? '#94a3b8' : '#cbd5e1'}"/>`
					: `<rect id="m${id++}" x="${n2(r.left - R.left)}" y="${n2(r.top - R.top)}" width="${n2(r.width)}" height="${n2(r.height)}" rx="${n2(Math.min(radius(cs), r.height / 2))}" fill="${small ? '#94a3b8' : '#e2e8f0'}"/>`);
				return;
			}
			if (hasBox(cs) || el === root) box(el, cs, r, depth);
			if (tag === 'input' || tag === 'textarea') {
				const val = el.value || el.getAttribute('placeholder') || '';
				if (val) {
					const fs = parseFloat(cs.fontSize);
					const color = hex(el.value ? cs.color : getComputedStyle(el, '::placeholder').color || cs.color);
					parts.push(`<text id="t${id++}" x="${n2(r.left - R.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth || 0))}" y="${n2(r.top - R.top + r.height / 2 + fs * 0.35)}" font-family="${esc(cs.fontFamily)}, Inter, system-ui, sans-serif" font-size="${fs}" font-weight="${cs.fontWeight}" fill="${color}">${esc(val.slice(0, 60))}</text>`);
				}
				return;
			}
			const short = txt(el).length <= 28;
			for (const ch of el.childNodes) {
				if (ch.nodeType === 3 && ch.textContent.trim()) textRun(ch, cs, short);
				else if (ch.nodeType === 1) walk(ch, depth + 1);
			}
		};
		walk(root, 0);
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(R.width)} ${n2(R.height)}" width="${n2(R.width)}" height="${n2(R.height)}">${parts.join('')}</svg>`;
	}

	// ---------- candidats ----------
	const all = [...document.querySelectorAll('body *')].filter((el) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'PATH', 'G', 'DEFS', 'USE', 'BR'].includes(el.tagName));
	const found = [];
	for (const el of all) {
		if (!visible(el)) continue;
		const role = roleOf(el);
		if (!role) continue;
		// A button in a button, a card in an identical card: keep the outer one.
		const parent = found.find((f) => f.el.contains(el) && f.role === role && Math.abs(rect(f.el).width - rect(el).width) < 12 && Math.abs(rect(f.el).height - rect(el).height) < 12);
		if (parent) continue;
		found.push({ el, role });
	}
	const cs0 = (el) => getComputedStyle(el);
	const out = found.slice(0, MAX * 3).map(({ el, role }, i) => {
		const cs = cs0(el), r = abs(rect(el));
		return {
			id: i + 1,
			role,
			tag: el.tagName.toLowerCase(),
			text: txt(el).slice(0, 140),
			box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
			style: { bg: hex(cs.backgroundColor), color: hex(cs.color), border: `${cs.borderTopWidth} ${hex(cs.borderTopColor)}`, radius: radius(cs), font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0]}`, shadow: cs.boxShadow !== 'none' },
			svg: svgFor(el, role, false),
			svgBars: svgFor(el, role, true)
		};
	});

	// ---------- design tokens (weighted by area) ----------
	const colors = {}, fonts = {}, radii = {};
	for (const el of all.slice(0, 4000)) {
		if (!visible(el)) continue;
		const cs = cs0(el), r = rect(el), area = Math.min(r.width * r.height, innerWidth * 400);
		if (!transparent(cs.backgroundColor)) colors[hex(cs.backgroundColor)] = (colors[hex(cs.backgroundColor)] || 0) + area;
		if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
			colors[hex(cs.color)] = (colors[hex(cs.color)] || 0) + r.width * 20;
			// First "real" font of the stack (not the emoji, flag or icon fonts placed first).
			const f = cs.fontFamily.split(',').map((x) => x.replace(/["']/g, '').trim()).find((x) => x && !/emoji|flag|icon|symbol|awesome/i.test(x));
			if (f) fonts[f] = (fonts[f] || 0) + 1;
		}
		const rr = radius(cs);
		if (rr > 0 && hasBox(cs)) { const k = rr > 200 ? 999 : Math.round(rr); radii[k] = (radii[k] || 0) + 1; }
	}
	const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k]) => k);
	return { candidates: out, tokens: { colors: top(colors, 12), fonts: top(fonts, 4), radii: top(radii, 5).map(Number) }, page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, title: document.title } };
}

// Number layer for the agent (added then removed).
function overlay(items) {
	const layer = document.createElement('div');
	layer.id = '__choreon_overlay';
	layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
	const colors = { button: '#e5534b', input: '#2f81f7', search: '#2f81f7', select: '#2f81f7', nav: '#a371f7', sidebar: '#a371f7', header: '#a371f7', tabs: '#a371f7', tab: '#a371f7', card: '#3fb950', badge: '#d29922', avatar: '#d29922', toggle: '#d29922', heading: '#8b949e', logo: '#db61a2', modal: '#3fb950', table: '#3fb950', chip: '#d29922', link: '#8b949e' };
	for (const it of items) {
		const c = colors[it.role] || '#e5534b';
		const b = document.createElement('div');
		b.style.cssText = `position:absolute;left:${it.box.x}px;top:${it.box.y}px;width:${it.box.w}px;height:${it.box.h}px;outline:2px solid ${c};outline-offset:-1px`;
		const l = document.createElement('div');
		l.textContent = it.id;
		l.style.cssText = `position:absolute;left:0;top:0;transform:translateY(-100%);background:${c};color:#fff;font:700 12px/16px system-ui;padding:0 4px`;
		b.appendChild(l);
		layer.appendChild(b);
	}
	document.body.appendChild(layer);
}

// ---------- flow ----------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...(a.storage && existsSync(a.storage) ? { storageState: a.storage } : {}) });
// Choreon harvesting its own local interface: the service token, sent to that origin only.
if (process.env.CHOREON_SELF_TOKEN) {
	const origin = new URL(a.url).origin;
	await context.route('**/*', (route) => {
		const req = route.request();
		if (new URL(req.url()).origin !== origin) return route.continue();
		return route.continue({ headers: { ...req.headers(), authorization: `Bearer ${process.env.CHOREON_SELF_TOKEN}` } });
	});
}
const page = await context.newPage();
await page.goto(a.url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(a.url, { waitUntil: 'load', timeout: 60000 }));
await page.waitForTimeout(Number(a.wait ?? 1500));
// Scrolls the page to trigger lazy loading and entrance animations, then returns to the top.
await page.addStyleTag({ content: 'html,body{scroll-behavior:auto!important}*{caret-color:transparent!important}' });
// Scrolls slowly to trigger lazy loading and scroll reveals (they stay
// visible afterwards), lets animations finish, then returns to the top.
await page.evaluate(async () => {
	const step = innerHeight * 0.6;
	for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
		window.scrollTo({ top: y, behavior: 'instant' });
		await new Promise((r) => setTimeout(r, 350));
	}
	await new Promise((r) => setTimeout(r, 1200));
	window.scrollTo({ top: 0, behavior: 'instant' });
	await new Promise((r) => setTimeout(r, 600));
});
await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 }).catch(() => {});

// App with an inner scroll area (the page doesn't scroll, a panel does): enlarge the window
// to that panel's height to see everything at once (cap 3200 px), then let it reflow.
const inner = await page.evaluate(() => {
	if (document.documentElement.scrollHeight > innerHeight + 40) return 0;
	let best = 0;
	for (const el of document.querySelectorAll('body *')) {
		const cs = getComputedStyle(el);
		if (!/(auto|scroll)/.test(cs.overflowY) || el.clientHeight < innerHeight * 0.4) continue;
		const extra = el.scrollHeight - el.clientHeight;
		if (extra > best) best = extra;
	}
	return best;
});
if (inner > 80) {
	await page.setViewportSize({ width: W, height: Math.min(3200, H + inner + 40) });
	await page.waitForTimeout(900);
}

const res = await page.evaluate(extract, MAX);
const pageH = Math.min(res.page.h, 12000);
await page.screenshot({ path: join(OUT, 'page.png'), fullPage: true });

// Deduplication: same role, same dimensions (±8%), same background → a single representative.
// Cards also keep their first word: cards of the same size but different content
// ("Mail", "Calendar"…) stay distinct; the agent then drops true duplicates.
const sig = (c) => `${c.role}|${Math.round(c.box.w / 16)}|${Math.round(c.box.h / 8)}|${c.style.bg}|${c.style.radius}${c.role === 'card' ? '|' + (c.text.split(' ')[0] || '') : ''}`;
const seen = new Map();
const kept = [];
for (const c of res.candidates) {
	if (c.box.y > pageH || c.box.w * c.box.h < 200) continue;
	const k = sig(c);
	if (seen.has(k)) {
		seen.get(k).repeats++;
		continue;
	}
	c.repeats = 1;
	seen.set(k, c);
	kept.push(c);
	if (kept.length >= MAX) break;
}

for (const c of kept) {
	writeFileSync(join(OUT, 'c', `${c.id}.svg`), c.svg);
	writeFileSync(join(OUT, 'c', `${c.id}-bars.svg`), c.svgBars);
	const pad = 4;
	await page.screenshot({ path: join(OUT, 'c', `${c.id}.png`), fullPage: true, clip: { x: Math.max(0, c.box.x - pad), y: Math.max(0, c.box.y - pad), width: Math.min(c.box.w + pad * 2, res.page.w), height: Math.min(c.box.h + pad * 2, 3000) } }).catch(() => {});
	delete c.svg;
	delete c.svgBars;
}

// Sheets numbered per screen slice (for selection by the agent).
await page.evaluate(overlay, kept);
const overlays = [];
for (let y = 0, k = 1; y < pageH && k <= 6; y += H, k++) {
	const file = join(OUT, `overlay-${k}.png`);
	await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: W, height: Math.min(H, pageH - y) } });
	overlays.push(file);
}
await browser.close();

const finalUrl = page.url();
writeFileSync(join(OUT, 'candidates.json'), JSON.stringify({ url: a.url, finalUrl, title: res.page.title, page: res.page, candidates: kept }, null, 1));
writeFileSync(join(OUT, 'tokens.json'), JSON.stringify(res.tokens, null, 1));
const roles = {};
for (const c of kept) roles[c.role] = (roles[c.role] ?? 0) + 1;
console.log(JSON.stringify({ out: OUT, finalUrl, title: res.page.title, candidates: kept.length, found: res.candidates.length, roles, overlays, tokens: res.tokens }));
