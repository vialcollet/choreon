import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ShotData, VoiceTrack } from '$lib/types';
import { db } from './db';
import * as jobs from './jobs';
import * as S from './store';
import * as V from './voice';

// A take re-fitted to a storyboard that kept its script: voice_generate and every storyboard import (I3).
const root = mkdtempSync(join(tmpdir(), 'choreon-fit-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const project = S.createProject('Fit', 'fit');
let n = 0;
const mkVideo = () => S.createVideo(project.id, { title: `Fit ${++n}`, brief: 'b', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 10 });

const TEXTS: Record<string, string> = { s02: 'Hello there.', s03: 'Goodbye.' };
const data = (key: string, voiceover = TEXTS[key] ?? ''): ShotData => ({ intent: 'i', visual: 'v', voiceover, beats: [] });
/** s01 is a silent card, s02 and s03 are voiced, s04 closes. */
const planned = (voiceover?: Record<string, string>) => [['s01', 3], ['s02', 3], ['s03', 3], ['s04', 2]].map(([key, duration]) => ({ key: key as string, title: key as string, duration: duration as number, data: data(key as string, voiceover?.[key as string]) }));
const mkStoryboard = (videoId: string, run: string | null = null) => S.createStoryboard(videoId, { logline: '', summary: '', shots: planned() }, run);

/** The recorded take on disk: voice.json, the WAV it points to, and the per-take record next to it. */
function record(vdir: string) {
	const dir = V.voiceDir(vdir);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, 'take.wav');
	writeFileSync(file, '');
	const track: VoiceTrack = {
		storyboardVersion: 1, voice: 'Charon', file, start: 0.3, duration: 8, createdAt: 1,
		words: [{ w: 'hello', t: 0, end: 0.4 }, { w: 'there', t: 0.5, end: 0.9 }, { w: 'goodbye', t: 2.5, end: 3 }],
		lines: [{ key: 's02', text: 'Hello there.', start: 0, end: 0.9 }, { key: 's03', text: 'Goodbye.', start: 2.5, end: 3 }]
	};
	writeFileSync(V.voiceJson(vdir), JSON.stringify(track, null, 1));
	writeFileSync(join(dir, 'take.json'), JSON.stringify(track, null, 1));
	return track;
}
const dirOf = (name: string) => mkdtempSync(join(root, `${name}-`));

describe('fitToVoice (D-5)', () => {
	test('AC-I3-2: cuts the shots to the take, gives them their words and moves the take after the opening card', () => {
		const video = mkVideo(), vdir = dirOf('cut');
		const track = record(vdir);
		const sb = mkStoryboard(video.id);
		const fit = V.fitToVoice(video, S.listShots(sb.id), track, vdir);
		expect(fit.cut).toBe(true);
		const shots = S.listShots(sb.id);
		expect(shots[0].duration).toBe(3);
		expect(shots[1].duration).toBeGreaterThanOrEqual(0.9 + 0.5 - 1 / 30);
		expect(shots.map((s) => s.data.voiceWords?.length)).toEqual([0, 2, 1, 0]);
		const stored = JSON.parse(readFileSync(V.voiceJson(vdir), 'utf8')) as VoiceTrack;
		expect(stored.start).toBeCloseTo(3.3, 6);
		expect(V.readVoice(vdir)?.start).toBeCloseTo(3.3, 6);
	});

	test('AC-I3-3: the per-take record next to the WAV stays as recorded', () => {
		const video = mkVideo(), vdir = dirOf('keep');
		const track = record(vdir);
		const before = readFileSync(join(V.voiceDir(vdir), 'take.json'), 'utf8');
		V.fitToVoice(video, S.listShots(mkStoryboard(video.id).id), track, vdir);
		expect(readFileSync(join(V.voiceDir(vdir), 'take.json'), 'utf8')).toBe(before);
		expect(JSON.parse(before).start).toBe(0.3);
	});

	test('AC-I3-2: shots already rendered in this take keep their length and the take its start, the words are still placed', () => {
		const video = mkVideo(), vdir = dirOf('built');
		const track = { ...record(vdir), start: 3.3 };
		const sb = mkStoryboard(video.id);
		S.createRender({ videoId: video.id, shotKey: 's02', version: 1, file: 'x.mp4', qa: {} as any, runId: null });
		const fit = V.fitToVoice(video, S.listShots(sb.id), track, vdir);
		expect(fit.cut).toBe(false);
		const shots = S.listShots(sb.id);
		expect(shots.map((s) => s.duration)).toEqual([3, 3, 3, 2]);
		expect(shots.map((s) => s.data.voiceWords?.length)).toEqual([0, 3, 0, 0]);
		expect(V.readVoice(vdir)?.start).toBe(3.3);
	});
});

describe('fitToVoice after a revision of the opening card (aa87d1f5)', () => {
	test('rendered shots keep their length but the take follows the new opening card, so the words land in the right shot', () => {
		const video = mkVideo(), vdir = dirOf('card');
		const track = { ...record(vdir), start: 3.3 };
		mkStoryboard(video.id);
		S.createRender({ videoId: video.id, shotKey: 's02', version: 1, file: 'x.mp4', qa: {} as any, runId: null });
		// The revision lengthens the opening card from 3 to 4 s.
		const run = S.insertRun({ projectId: project.id, videoId: video.id, kind: 'storyboard_revise', title: 'revise', input: {} });
		const revised = S.createStoryboard(video.id, { logline: '', summary: '', shots: planned().map((s) => (s.key === 's01' ? { ...s, duration: 4 } : s)) }, run.id);
		const fit = V.fitToVoice(video, S.listShots(revised.id), track, vdir);
		expect(fit.cut).toBe(false);
		const shots = S.listShots(revised.id);
		expect(shots.map((s) => s.duration)).toEqual([4, 3, 3, 2]);
		expect(V.readVoice(vdir)?.start).toBeCloseTo(4.3, 6);
		expect(fit.track.start).toBeCloseTo(4.3, 6);
		// s02 runs from 4 to 7 s: the take's three words (4.3, 4.8 and 6.8) are all in it, none in the card.
		expect(shots.map((s) => s.data.voiceWords?.length)).toEqual([0, 3, 0, 0]);
		expect(shots[1].data.voiceWords?.[0].t).toBeCloseTo(0.3, 2);
	});
});

describe('fitToVoice is all or nothing (90378356)', () => {
	test('a failure while updating the shots leaves voice.json and every shot as they were', () => {
		const video = mkVideo(), vdir = dirOf('atomic');
		const track = record(vdir);
		const sb = mkStoryboard(video.id);
		const shots = S.listShots(sb.id);
		const before = readFileSync(V.voiceJson(vdir), 'utf8');
		const stored = JSON.stringify(shots);
		// A shot whose data cannot be serialized: the update of the third shot throws after the first two went through.
		const broken = shots.map((s, i) => (i === 2 ? { ...s, data: { ...s.data, voiceover: 1n as any } } : s));
		expect(() => V.fitToVoice(video, broken, track, vdir)).toThrow();
		expect(readFileSync(V.voiceJson(vdir), 'utf8')).toBe(before);
		expect(existsSync(`${V.voiceJson(vdir)}.tmp`)).toBe(false);
		expect(JSON.stringify(S.listShots(sb.id))).toBe(stored);
	});
});

describe('importDraft re-fits a take whose script the revision kept (I3)', () => {
	const draft = (dir: string, voiceover?: Record<string, string>) => {
		const file = join(dir, 'draft.json');
		writeFileSync(file, JSON.stringify({ logline: '', summary: '', shots: planned(voiceover).map((s) => ({ key: s.key, title: s.title, duration: s.duration, ...s.data })) }));
		return file;
	};
	const revise = (video: S.Video, vdir: string, voiceover?: Record<string, string>) => {
		mkStoryboard(video.id);
		const run = S.insertRun({ projectId: project.id, videoId: video.id, kind: 'storyboard_revise', title: 'revise', input: {} });
		const sb = jobs.importDraft(video.id, root, draft(vdir, voiceover), run.id, vdir);
		return S.listShots(sb.id);
	};

	test('AC-I3-2: the new version carries the words and the cut durations', () => {
		const video = mkVideo(), vdir = dirOf('rev');
		record(vdir);
		const shots = revise(video, vdir);
		expect(shots.map((s) => s.data.voiceWords?.length)).toEqual([0, 2, 1, 0]);
		expect(shots[0].duration).toBe(3);
		expect(shots[1].duration).toBeGreaterThanOrEqual(0.9 + 0.5 - 1 / 30);
		expect(V.readVoice(vdir)?.start).toBeCloseTo(3.3, 6);
	});

	test('a revision that changed the script leaves the shots and the take alone', () => {
		const video = mkVideo(), vdir = dirOf('changed');
		record(vdir);
		const shots = revise(video, vdir, { s02: 'Hello you.' });
		expect(shots.every((s) => s.data.voiceWords === undefined)).toBe(true);
		expect(shots.map((s) => s.duration)).toEqual([3, 3, 3, 2]);
		expect(V.readVoice(vdir)?.start).toBe(0.3);
	});

	test('a revision whose re-fit fails is not kept: the previous version stays current and no shot is left behind (1712ebbe)', () => {
		const video = mkVideo(), vdir = dirOf('failed');
		record(vdir);
		const previous = mkStoryboard(video.id);
		const run = S.insertRun({ projectId: project.id, videoId: video.id, kind: 'storyboard_revise', title: 'revise', input: {} });
		// The re-fit cannot replace voice.json: its temporary file is taken by a directory.
		mkdirSync(`${V.voiceJson(vdir)}.tmp`);
		const before = readFileSync(V.voiceJson(vdir), 'utf8');
		expect(() => jobs.importDraft(video.id, root, draft(vdir), run.id, vdir)).toThrow();
		expect(S.getStoryboard(video.id)?.id).toBe(previous.id);
		expect(S.listStoryboards(video.id).map((s) => s.version)).toEqual([1]);
		expect(S.listShots(previous.id)).toHaveLength(4);
		expect(db.query('SELECT COUNT(*) n FROM shots WHERE storyboard_id NOT IN (SELECT id FROM storyboards)').get()).toEqual({ n: 0 });
		expect(readFileSync(V.voiceJson(vdir), 'utf8')).toBe(before);
	});

	test('a video without a take imports as before', () => {
		const video = mkVideo(), vdir = dirOf('none');
		const shots = revise(video, vdir);
		expect(shots.every((s) => s.data.voiceWords === undefined)).toBe(true);
		expect(shots.map((s) => s.duration)).toEqual([3, 3, 3, 2]);
	});
});

describe('a translated film keeps the lengths of its scenes', () => {
	test('its take counts as animated from the start; a new storyboard from scratch starts a take that is not', () => {
		const video = mkVideo();
		const tr = S.insertRun({ projectId: project.id, videoId: video.id, kind: 'video_translate', title: 't', input: {} });
		const sb = S.createStoryboard(video.id, { logline: '', summary: '', shots: planned() }, tr.id);
		expect(S.takeIsTranslation(video.id)).toBe(true);
		expect(V.shotsBuilt(video, S.listShots(sb.id))).toBe(true);
		const gen = S.insertRun({ projectId: project.id, videoId: video.id, kind: 'storyboard_generate', title: 'g', input: {} });
		const fresh = S.createStoryboard(video.id, { logline: '', summary: '', shots: planned() }, gen.id);
		expect(S.takeIsTranslation(video.id)).toBe(false);
		expect(V.shotsBuilt(video, S.listShots(fresh.id))).toBe(false);
	});

	test('a video keeps its own language', () => {
		const v = S.createVideo(project.id, { title: 'Fit translated', brief: '', format: { width: 1080, height: 1920, fps: 30 }, targetDuration: 10, language: 'en' });
		expect(S.getVideo(v.id)?.language).toBe('en');
		expect(mkVideo().language).toBeNull();
		expect(S.freeSlug(project.id, 'Fit translated')).toBe('fit-translated-2');
	});
});
