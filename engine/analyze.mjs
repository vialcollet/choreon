#!/usr/bin/env node
// Analysis of a reference video: cuts (shot-change detection), rhythm,
// dominant palette and image sheets, so an agent can derive a style guide.
//
//   node engine/analyze.mjs --video ref.mp4 --dir out/ [--step 0.5] [--scene 0.3]
//
// Output (out/analysis.json): duration, cuts, shot lengths, palette (hex + share),
// sheets (sheet-01.png…, 24 frames each, one every `step` s).

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

const run = (list, opts = {}) => spawnSync(ffmpegPath, list, { encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 28 });

function probe(video) {
	const r = run(['-i', video]);
	const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '');
	const v = /Video: .*?, (\d{2,5})x(\d{2,5})/.exec(r.stderr || '');
	const f = /([\d.]+) fps/.exec(r.stderr || '');
	return {
		duration: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0,
		width: v ? Number(v[1]) : 0,
		height: v ? Number(v[2]) : 0,
		fps: f ? Number(f[1]) : 0
	};
}

/** Shot-change instants (ffmpeg scene score above the threshold). */
function cuts(video, threshold) {
	const r = run(['-i', video, '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-']);
	const ts = [...(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
	return ts.filter((t, i) => i === 0 || t - ts[i - 1] > 0.2);
}

/** Dominant palette: 12 colors via palettegen on sampled frames, with their share. */
function palette(video, dir) {
	const pal = join(dir, 'palette.png');
	run(['-y', '-loglevel', 'error', '-i', video, '-vf', 'fps=2,scale=320:-1:flags=area,palettegen=max_colors=12:stats_mode=full:reserve_transparent=0', '-frames:v', '1', pal]);
	const raw = run(['-loglevel', 'error', '-i', pal, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { binary: true }).stdout;
	const colors = [];
	for (let i = 0; i + 2 < raw.length; i += 3) {
		const hex = '#' + [raw[i], raw[i + 1], raw[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join('');
		if (!colors.includes(hex)) colors.push(hex);
	}
	return colors.slice(0, 12);
}

// ---------- mouvement ----------

/** Frame-by-frame motion energy: mean luminance difference with the previous frame (0..255). */
function motionCurve(video) {
	const r = run(['-i', video, '-vf', 'scale=320:-1,signalstats,metadata=print:key=lavfi.signalstats.YDIF', '-an', '-f', 'null', '-']);
	const out = [];
	let t = null;
	for (const line of (r.stderr || '').split('\n')) {
		const m = /pts_time:([\d.]+)/.exec(line);
		if (m) t = Number(m[1]);
		const v = /YDIF=([\d.]+)/.exec(line);
		if (v && t !== null) out.push([t, Number(v[1])]);
	}
	return out;
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

/**
  * Splits the curve into movements (energy above an adaptive threshold), excluding cuts, and
  * classifies the easing from the shape: early peak = ease-out, late peak = ease-in, central peak =
  * ease-in-out, flat = linear; a second peak after the main one signals overshoot.
 */
function motionSegments(curve, cutList, fps) {
	const dt = 1 / (fps || 30);
	// Neutralize cut frames (a shot jump is not a movement).
	const vals = curve.map(([t, v]) => (cutList.some((c) => Math.abs(c - t) < dt * 1.5) ? 0 : v));
	const smooth = vals.map((_, i) => (vals[Math.max(0, i - 1)] + vals[i] + vals[Math.min(vals.length - 1, i + 1)]) / 3);
	// Double threshold tuned to the video: `high` spots a movement, `low` finds its true start and
	// true end (a small object on a large static background produces little global difference).
	// Compression noise (p10) raises both thresholds on real videos.
	const sorted = [...smooth].sort((a, b) => a - b);
	const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
	const high = Math.max(q(0.1) * 3, q(0.97) * 0.06, 0.05);
	const low = Math.max(q(0.1) * 1.5, high * 0.3);
	const thr = high;
	const segs = [];
	for (let i = 0; i < smooth.length; i++) {
		if (smooth[i] <= high) continue;
		let a = i, b = i;
		while (a > 0 && smooth[a - 1] > low) a--;
		while (b < smooth.length - 1 && smooth[b + 1] > low) b++;
		// Cut at the troughs: if the raw value drops under `low` between two clear peaks, they are
		// two chained movements (smoothing often hides a one-frame pause).
		let from = a;
		for (let k = a + 1; k < b; k++) {
			if (vals[k] >= low) continue;
			const left = Math.max(...smooth.slice(from, k));
			const right = Math.max(...smooth.slice(k + 1, b + 1));
			if (left > high && right > high) {
				segs.push({ start: curve[from][0], end: curve[k - 1][0] });
				from = k + 1;
			}
		}
		const seg = { start: curve[from][0], end: curve[b][0] };
		const prev = segs.at(-1);
		if (prev && seg.start - prev.end <= 0.05) prev.end = Math.max(prev.end, seg.end);
		else if (!prev || seg.start > prev.end) segs.push(seg);
		i = b;
	}
	const moves = segs
		.filter((s) => s.end - s.start >= 0.1)
		.map((s) => {
			const idx = curve.map((c, i) => i).filter((i) => curve[i][0] >= s.start && curve[i][0] <= s.end);
			const v = idx.map((i) => smooth[i]);
			const peak = Math.max(...v);
			const pi = v.indexOf(peak);
			const dur = s.end - s.start;
			const peakPos = dur ? (curve[idx[pi]][0] - s.start) / dur : 0.5;
			const mean = v.reduce((a, b) => a + b, 0) / v.length;
			const cv = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) / (mean || 1);
			// Overshoot: after the peak, a trough then a rise > 30% of the peak.
			let overshoot = false;
			for (let k = pi + 2, low = peak; k < v.length; k++) {
				low = Math.min(low, v[k - 1]);
				if (low < peak * 0.5 && v[k] > low + peak * 0.3) {
					overshoot = true;
					break;
				}
			}
			const easing = cv < 0.25 ? 'linear' : peakPos < 0.35 ? 'ease-out' : peakPos > 0.65 ? 'ease-in' : 'ease-in-out';
			return { start: +s.start.toFixed(2), end: +s.end.toFixed(2), dur: +dur.toFixed(2), peak: +peak.toFixed(2), peakPos: +peakPos.toFixed(2), energy: +(mean * dur).toFixed(2), easing, overshoot };
		});
	const holds = [];
	moves.forEach((m, i) => {
		const next = moves[i + 1];
		if (next && next.start - m.end >= 0.3) holds.push(+(next.start - m.end).toFixed(2));
	});
	const total = curve.length ? curve.at(-1)[0] : 0;
	const inMotion = moves.reduce((a, m) => a + m.dur, 0);
	const counts = moves.reduce((a, m) => ((a[m.easing] = (a[m.easing] ?? 0) + 1), a), {});
	return {
		threshold: +thr.toFixed(2),
		moves,
		holds,
		summary: {
			moves: moves.length,
			medianMove: median(moves.map((m) => m.dur)),
			medianHold: median(holds),
			motionShare: total ? +(inMotion / total).toFixed(2) : 0,
			easing: counts,
			overshoots: moves.filter((m) => m.overshoot).length
		},
		smooth: curve.map((c, i) => [c[0], +smooth[i].toFixed(3)])
	};
}

/** SVG graph of the curve (movements highlighted, cuts as lines), rendered to PNG by Chromium. */
async function motionChart(curve, motion, cutList, file) {
	const W = 1600, H = 360, T = curve.length ? curve.at(-1)[0] : 1;
	const maxV = Math.max(1, ...curve.map((c) => c[1]));
	const x = (t) => (t / T) * W, y = (v) => H - 20 - (v / maxV) * (H - 40);
	const pts = curve.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#111;font:12px sans-serif">
${motion.moves.map((m, i) => `<rect x="${x(m.start)}" y="0" width="${Math.max(2, x(m.end) - x(m.start))}" height="${H - 20}" fill="${m.overshoot ? '#e5a83b' : '#2e6f58'}" opacity="0.35"/><text x="${x(m.start) + 2}" y="14" fill="#ddd">${i + 1}</text>`).join('')}
${cutList.map((c) => `<line x1="${x(c)}" x2="${x(c)}" y1="0" y2="${H - 20}" stroke="#e5534b" stroke-dasharray="4 3"/>`).join('')}
<line x1="0" x2="${W}" y1="${y(motion.threshold)}" y2="${y(motion.threshold)}" stroke="#888" stroke-dasharray="2 4"/>
<polyline points="${pts}" fill="none" stroke="#dee5ec" stroke-width="1.5"/>
${Array.from({ length: Math.floor(T) + 1 }, (_, s) => `<text x="${x(s) + 2}" y="${H - 4}" fill="#888">${s}s</text>`).join('')}
</svg>`;
	const { chromium } = await import('playwright');
	const b = await chromium.launch();
	try {
		const p = await b.newPage({ viewport: { width: W, height: H } });
		await p.setContent(`<body style="margin:0">${svg}</body>`);
		await p.screenshot({ path: file });
	} finally {
		await b.close();
	}
	return file;
}

/** Strips of consecutive frames (native rate, 16 max) on the strongest movements. */
function motionStrips(video, motion, dir, fps, n = 4) {
	const top = [...motion.moves].sort((a, b) => b.energy - a.energy).slice(0, n).sort((a, b) => a.start - b.start);
	return top.map((m, i) => {
		const from = Math.max(0, m.start - 2 / (fps || 30));
		const dur = m.dur + 4 / (fps || 30);
		const rate = Math.min(fps || 30, 16 / dur);
		const file = join(dir, `move-${String(i + 1).padStart(2, '0')}.png`);
		run(['-y', '-loglevel', 'error', '-ss', String(from), '-t', String(dur), '-i', video, '-vf', `fps=${rate.toFixed(3)},scale=240:-1,pad=iw+4:ih+4:2:2:color=0x888888,tile=8x2`, '-frames:v', '1', file]);
		return { file, move: motion.moves.indexOf(m) + 1, start: m.start, end: m.end, easing: m.easing, overshoot: m.overshoot, fpsShown: +rate.toFixed(1) };
	});
}

export async function analyze({ video, dir, step = 0.5, scene = 0.3 }) {
	video = resolve(video);
	dir = resolve(dir);
	mkdirSync(dir, { recursive: true });
	const info = probe(video);
	const cutList = cuts(video, scene);
	const bounds = [0, ...cutList, info.duration];
	const shots = bounds.slice(1).map((t, i) => +(t - bounds[i]).toFixed(2)).filter((d) => d > 0.05);
	const sorted = [...shots].sort((a, b) => a - b);
	const stats = {
		count: shots.length,
		mean: shots.length ? +(shots.reduce((a, b) => a + b, 0) / shots.length).toFixed(2) : 0,
		median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
		min: sorted[0] ?? 0,
		max: sorted.at(-1) ?? 0,
		cutsPerMinute: info.duration ? +((cutList.length / info.duration) * 60).toFixed(1) : 0
	};
	// Sheets: 24 frames (6×4) each, one every `step` s, timestamped in reading order.
	const perSheet = 24;
	const n = Math.max(1, Math.ceil(info.duration / step));
	const sheets = [];
	for (let s = 0; s * perSheet < n && s < 8; s++) {
		const from = s * perSheet * step;
		const file = join(dir, `sheet-${String(s + 1).padStart(2, '0')}.png`);
		run(['-y', '-loglevel', 'error', '-ss', String(from), '-t', String(perSheet * step), '-i', video, '-vf', `fps=${1 / step},scale=320:-1,pad=iw+4:ih+4:2:2:color=0x888888,tile=6x4`, '-frames:v', '1', file]);
		sheets.push({ file, from: +from.toFixed(2), to: +Math.min(info.duration, from + perSheet * step).toFixed(2) });
	}
	// One sharp frame in the middle of each shot (up to 16) to judge typography and composition.
	const keys = [];
	bounds.slice(1).forEach((t, i) => {
		if (keys.length >= 16) return;
		const mid = (bounds[i] + t) / 2;
		const file = join(dir, `shot-${String(i + 1).padStart(2, '0')}.png`);
		run(['-y', '-loglevel', 'error', '-ss', String(mid), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-1', file]);
		keys.push({ file, t: +mid.toFixed(2) });
	});
	const curve = motionCurve(video);
	const motion = motionSegments(curve, cutList, info.fps);
	const chart = curve.length ? await motionChart(motion.smooth, motion, cutList, join(dir, 'motion.png')) : null;
	const strips = motionStrips(video, motion, dir, info.fps);
	writeFileSync(join(dir, 'motion.json'), JSON.stringify({ threshold: motion.threshold, summary: motion.summary, moves: motion.moves, holds: motion.holds }, null, 1));
	const { smooth: _s, ...motionOut } = motion;
	const result = { video, ...info, step, cuts: cutList.map((t) => +t.toFixed(2)), shots, stats, palette: palette(video, dir), sheets, keys, motion: { ...motionOut, chart, strips } };
	writeFileSync(join(dir, 'analysis.json'), JSON.stringify(result, null, 1));
	return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const o = args(process.argv.slice(2));
	analyze({ video: o.video, dir: o.dir, step: Number(o.step || 0.5), scene: Number(o.scene || 0.3) })
		.then((r) => console.log(JSON.stringify(r)))
		.catch((e) => {
			console.log(JSON.stringify({ error: String(e.message || e) }));
			process.exit(1);
		});
}
