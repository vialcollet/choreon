#!/usr/bin/env node
// Sheet of local still images (visual check of a shot), with the instant under each image.
//   node engine/sheet.mjs --dir <folder of t*.png> --out sheet.png [--cols 4] [--width 480]

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
const cols = Number(a.cols ?? 4), w = Number(a.width ?? 480);
const files = readdirSync(a.dir)
	.filter((f) => /^t\d+_\d+\.png$/.test(f))
	.map((f) => ({ f, t: parseFloat(f.slice(1, -4).replace('_', '.')) }))
	.sort((x, y) => x.t - y.t);
if (!files.length) throw new Error('no t*.png image');
const h = Math.round((w * 9) / 16), lab = 34;
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/segoeui.ttf':" : '';
const inputs = files.flatMap(({ f }) => ['-i', join(a.dir, f)]);
const cells = files.map(({ t }, i) => `[${i}:v]scale=${w}:${h},pad=${w}:${h + lab}:0:0:0x15181d,drawtext=${font}text='${t.toFixed(2).replace('.', ',')} s':fontcolor=0xdee5ec:fontsize=20:x=8:y=${h + 6}[c${i}]`);
const rows = Math.ceil(files.length / cols);
const layout = files.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * (h + lab)}`).join('|');
const filter = `${cells.join(';')};${files.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=0x15181d,pad=${cols * w}:${rows * (h + lab)}:0:0:0x15181d[o]`;
const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[o]', '-frames:v', '1', a.out], { encoding: 'utf8' });
if (r.status) throw new Error(r.stderr);
console.log(JSON.stringify({ out: a.out, count: files.length }));
