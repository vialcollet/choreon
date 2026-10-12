#!/usr/bin/env node
// Voice-over: the whole script read in ONE take (Gemini TTS) so the delivery stays coherent, checked
// word for word by Whisper (Groq), cleaned, then aligned: each storyboard line gets its start and end
// in the take, each word its timestamp. The studio places the take on the film and syncs the image to it.
//
//   node engine/voice.mjs --script script.json --out voice.wav [--voice Charon] [--style "director's notes"] [--tries 6]
//   script.json: { "lines": [{ "key": "s01", "text": "Every video starts with an idea." }, …] }
//   env: GEMINI_API_KEY (speech), GROQ_API_KEY (word timings and check); GEMINI_TTS_MODEL optional.
//
// Gemini quirks handled here: it sometimes reads its director's notes aloud (the take is rejected:
// those words show up in the transcript), it puts a full-scale click in the first milliseconds and
// appends a burst of noise after the speech (both removed).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { align, norm, placeLines, tokens } from './voice-align.mjs';

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const k = argv[i].slice(2);
		out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
	}
	return out;
}

const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PCM s16le mono → WAV. */
function wavOf(pcm, rate) {
	const h = Buffer.alloc(44);
	h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
	h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([h, pcm]);
}

async function speak(text, voice, style) {
	// Without notes, send the bare text: an empty notes header is itself sometimes read aloud.
	const prompt = style ? `### DIRECTOR'S NOTES\n${style}\n\n### TRANSCRIPT\n${text}` : text;
	const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
		method: 'POST',
		headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
		body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })
	});
	const j = await r.json();
	if (r.status === 429) return { limited: true, msg: String(j.error?.message ?? '').slice(0, 160) };
	if (!r.ok) throw new Error(`Gemini TTS ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
	const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
	if (!part) throw new Error('Gemini TTS returned no audio');
	const data = Buffer.from(part.inlineData.data, 'base64');
	// Raw PCM (audio/L16;rate=…) or, depending on the model version, a whole WAV file.
	if (data.toString('ascii', 0, 4) === 'RIFF') {
		const rate = data.readUInt32LE(24);
		let p = 12;
		while (p + 8 <= data.length && data.toString('ascii', p, p + 4) !== 'data') p += 8 + data.readUInt32LE(p + 4);
		return { pcm: data.subarray(p + 8), rate };
	}
	return { pcm: data, rate: Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000) };
}

/** Silences the click at the start, walks back over the noise burst at the end, short fades. */
function clean(buf, rate) {
	const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 2)));
	const blk = Math.round(rate * 0.01);
	const rms = (a) => { let s = 0; for (let i = a; i < a + blk; i++) s += pcm[i] * pcm[i]; return Math.sqrt(s / blk); };
	let end = pcm.length - (pcm.length % blk);
	while (end - blk > 0 && rms(end - blk) > 6000) end -= blk;
	const out = pcm.slice(0, end);
	const head = Math.round(rate * 0.012), fade = Math.round(rate * 0.015);
	for (let i = 0; i < head && i < out.length; i++) out[i] = 0;
	for (let i = 0; i < fade && head + i < out.length; i++) out[head + i] = Math.round(out[head + i] * (i / fade));
	for (let i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] = Math.round(out[out.length - 1 - i] * (i / fade));
	return Buffer.from(out.buffer);
}

async function transcribe(wav) {
	const f = new FormData();
	f.append('model', 'whisper-large-v3-turbo');
	f.append('response_format', 'verbose_json');
	f.append('timestamp_granularities[]', 'word');
	f.append('file', new Blob([wav]), 'voice.wav');
	const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: f });
	const j = await r.json();
	if (!r.ok) throw new Error(`Groq Whisper ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
	return { text: j.text ?? '', words: (j.words ?? []).map((w) => ({ w: String(w.word).trim(), t: +w.start.toFixed(3), end: +w.end.toFixed(3) })) };
}

async function main() {
	const o = args(process.argv.slice(2));
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing (Settings → API keys)');
	if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing: it times every word (Settings → API keys)');
	const lines = JSON.parse(readFileSync(resolve(o.script), 'utf8')).lines.filter((l) => l.text && l.text.trim());
	if (!lines.length) throw new Error('the script is empty');
	const voice = o.voice || 'Charon';
	const style = o.style && o.style !== 'true' ? o.style : '';
	const tries = Number(o.tries || 6);
	// One paragraph per shot: the reader pauses between them, the way the film cuts.
	const text = lines.map((l) => l.text.trim()).join('\n\n');
	const script = lines.flatMap((l, li) => tokens(l.text).map((w) => ({ w, li })));
	const noteWords = tokens(style).filter((w) => w.length > 5 && !script.some((s) => s.w === w));
	const log = [];
	for (let k = 1; k <= tries; k++) {
		const r = await speak(text, voice, style);
		if (r.limited) { log.push(`try ${k}: rate limited ${r.msg}`); await sleep(30000); continue; }
		const wav = wavOf(clean(r.pcm, r.rate), r.rate);
		const heard = await transcribe(wav);
		const got = heard.words.map((x) => norm(x.w)).filter(Boolean);
		if (!got.length) { log.push(`try ${k}: rejected (empty transcript)`); continue; }
		const map = align(script.map((s) => s.w), got);
		const missing = map.filter((x) => x < 0).length;
		const extra = got.length - map.filter((x) => x >= 0).length;
		const leaked = noteWords.some((w) => got.includes(w));
		const tol = Math.max(1, Math.round(script.length * 0.04));
		if (leaked || missing > tol || extra > tol + 2) { log.push(`try ${k}: rejected (${missing} missing, ${extra} extra${leaked ? ', notes read aloud' : ''})`); continue; }
		const words = heard.words.filter((x) => norm(x.w));
		const out = placeLines(lines, script, words, map);
		if (!out) { log.push(`try ${k}: rejected (a line was not heard)`); continue; }
		writeFileSync(resolve(o.out), wav);
		const duration = +((wav.length - 44) / 2 / r.rate).toFixed(3);
		// Whisper's end times can overshoot the (cleaned) take.
		for (const x of [...words, ...out]) { x.end = Math.min(x.end, duration); x.start != null && (x.start = Math.min(x.start, duration)); }
		console.log(JSON.stringify({ out: resolve(o.out), voice, duration, words, lines: out, transcript: heard.text.trim(), tries: k, log }));
		return;
	}
	throw new Error(`no clean take in ${tries} tries: ${log.join('; ')}`);
}

main().catch((e) => {
	console.log(JSON.stringify({ error: String(e.message || e) }));
	process.exit(1);
});
