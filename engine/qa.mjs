#!/usr/bin/env node
// Check sheets from an MP4 render — what the critic (Opus) looks at.
//
//   node engine/qa.mjs --video render.mp4 --dir qa/ [--fps 4] [--cols 6] [--strip 2.4] [--phone]
//
// Produces: contact.png (timestamped grid), strip.png (12 consecutive frames around
// an instant, to spot jerks), phone.png (legibility at 360 px wide).

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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

function ff(list) {
	const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', ...list], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(r.stderr || `ffmpeg ${r.status}`);
}

function duration(video) {
	const r = spawnSync(ffmpegPath, ['-i', video], { encoding: 'utf8' });
	const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '');
	return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

export function qa({ video, dir, fps = 4, cols = 6, strip, phone = true }) {
	video = resolve(video);
	dir = resolve(dir);
	mkdirSync(dir, { recursive: true });
	const dur = duration(video);
	const n = Math.max(1, Math.ceil(dur * fps));
	const rows = Math.ceil(n / cols);
	const out = { video, duration: dur };
	// drawtext requires a font: timestamp via the column name rather than overlay,
	// keeping reading order left→right, top→bottom at `fps` frames/s.
	ff(['-i', video, '-vf', `fps=${fps},scale=320:-1,pad=iw+4:ih+4:2:2:color=0x888888,tile=${cols}x${rows}`, '-frames:v', '1', join(dir, 'contact.png')]);
	out.contact = { file: join(dir, 'contact.png'), fps, cols, rows, frames: n };
	if (strip !== undefined) {
		const t = Math.max(0, Number(strip) - 0.2);
		ff(['-ss', String(t), '-i', video, '-vf', 'scale=320:-1,tile=12x1', '-frames:v', '1', join(dir, 'strip.png')]);
		out.strip = { file: join(dir, 'strip.png'), from: t, frames: 12 };
	}
	if (phone) {
		ff(['-i', video, '-vf', `fps=1,scale=360:-1,tile=5x${Math.max(1, Math.ceil(dur / 5))}`, '-frames:v', '1', join(dir, 'phone.png')]);
		out.phone = { file: join(dir, 'phone.png') };
	}
	return out;
}

/**
  * Exact frame at instant t (for an annotation). box = "x,y,w,h" normalized 0..1:
  * the targeted area is framed in red so the agent knows where to look.
 */
export function frameAt(video, t, file, box) {
	const vf = [];
	if (box) {
		const [x, y, w, h] = String(box).split(',').map(Number);
		vf.push(`drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=0xff2d55@0.95:t=6`);
	}
	ff(['-ss', String(t), '-i', resolve(video), ...(vf.length ? ['-vf', vf.join(',')] : []), '-frames:v', '1', resolve(file)]);
	return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const o = args(process.argv.slice(2));
	try {
		if (o.frame) console.log(JSON.stringify({ file: frameAt(o.video, Number(o.frame), o.out, o.box) }));
		else console.log(JSON.stringify(qa({ video: o.video, dir: o.dir, fps: Number(o.fps || 4), cols: Number(o.cols || 6), strip: o.strip, phone: o.phone !== 'false' })));
	} catch (e) {
		console.log(JSON.stringify({ error: String(e.message || e) }));
		process.exit(1);
	}
}
