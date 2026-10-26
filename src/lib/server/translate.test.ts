import { describe, expect, test } from 'bun:test';
import type { ShotData } from '$lib/types';
import { applyTranslation, repointPaths, translationSource } from './translate';

const data = (over: Partial<ShotData> = {}): ShotData => ({
	intent: 'Montrer la journée',
	visual: 'Le tableau de bord',
	onScreenText: 'Bonjour',
	voiceover: 'Omeon a préparé votre journée.',
	beats: [{ t: 0, state: 'vide', cursor: '', sound: '' }, { t: 1.2, state: 'la carte arrive', cursor: 'clic sur « Ouvrir »', sound: 'clic' }],
	assets: ['brand/logo/logo.svg'],
	voiceWords: [{ w: 'Omeon', t: 0.3 }],
	...over
});
const shots = [
	{ key: 's01', title: 'Matin', duration: 3.5, data: data(), refImage: '/p/videos/une-journee/storyboard/refs/s01.png' },
	{ key: 's02', title: 'Fin', duration: 2, data: data({ voiceover: '', beats: [{ t: 0, state: 'logo', cursor: '', sound: '' }], directorNotes: ['Pas de rebond'] }), refImage: null }
];
const en = {
	title: 'A day with Omeon',
	brief: 'A film',
	decisions: { message: 'Save time', ignored: 3 },
	logline: 'Omeon prepares the day',
	summary: 'Six shots.',
	shots: [
		{ key: 's01', title: 'Morning', intent: 'Show the day', visual: 'The dashboard', onScreenText: 'Hello', voiceover: 'Omeon has prepared your day.', beats: [{ state: 'empty' }, { state: 'the card arrives', cursor: 'click on “Open”', sound: 'click' }] },
		{ key: 's02', title: 'End', beats: [{ state: 'logo' }], directorNotes: ['No bounce'] }
	]
};

describe('applyTranslation', () => {
	test('lays the text over the source shots and keeps everything else', () => {
		const t = applyTranslation(shots, en);
		expect(t.title).toBe('A day with Omeon');
		expect(t.decisions).toEqual({ message: 'Save time' });
		const [a, b] = t.shots;
		expect(a).toMatchObject({ key: 's01', title: 'Morning', duration: 3.5, refImage: shots[0].refImage });
		expect(a.data).toMatchObject({ intent: 'Show the day', onScreenText: 'Hello', voiceover: 'Omeon has prepared your day.', assets: ['brand/logo/logo.svg'] });
		expect(a.data.beats).toEqual([{ t: 0, state: 'empty', cursor: '', sound: '' }, { t: 1.2, state: 'the card arrives', cursor: 'click on “Open”', sound: 'click' }]);
		expect(b.data).toMatchObject({ intent: 'Montrer la journée', voiceover: '', directorNotes: ['No bounce'] });
	});

	test('drops the words recorded in the source language', () => {
		expect(applyTranslation(shots, en).shots.every((s) => s.data.voiceWords === undefined)).toBe(true);
	});

	test('refuses a translation that misses a shot or a beat, rather than mixing two languages', () => {
		expect(() => applyTranslation(shots, { ...en, shots: [en.shots[0]] })).toThrow('s02');
		expect(() => applyTranslation(shots, { ...en, shots: [{ ...en.shots[0], beats: [{ state: 'empty' }] }, en.shots[1]] })).toThrow('beats');
		expect(() => applyTranslation(shots, null)).toThrow();
	});

	test('the reference images can move with the copied folder', () => {
		const t = applyTranslation(shots, en, (f) => f?.replace('une-journee/', 'une-journee-en/') ?? null);
		expect(t.shots[0].refImage).toBe('/p/videos/une-journee-en/storyboard/refs/s01.png');
		expect(t.shots[1].refImage).toBeNull();
	});
});

test('translationSource lists every text to translate, keyed by shot', () => {
	const src = translationSource({ title: 'Une journée', brief: 'Un film', decisions: { message: 'Gagner du temps' } }, { logline: 'L', summary: 'S' }, shots);
	expect(src.shots.map((s) => s.key)).toEqual(['s01', 's02']);
	expect(src.shots[0].beats).toEqual([{ state: 'vide', cursor: '', sound: '' }, { state: 'la carte arrive', cursor: 'clic sur « Ouvrir »', sound: 'clic' }]);
	expect(src.shots[1].directorNotes).toEqual(['Pas de rebond']);
	expect(JSON.stringify(src)).not.toContain('voiceWords');
});

test('repointPaths moves paths into the source folder, and only that folder', () => {
	const scene = `import { mount } from '/project/videos/une-journee/storyboard/refs/v1/_lib/app.js';
<img src="/project/videos/une-journee-vertical/logo.png"> videos/une-journee/x.png notvideos/une-journee/y`;
	expect(repointPaths(scene, 'une-journee', 'une-journee-en')).toBe(`import { mount } from '/project/videos/une-journee-en/storyboard/refs/v1/_lib/app.js';
<img src="/project/videos/une-journee-vertical/logo.png"> videos/une-journee-en/x.png notvideos/une-journee/y`);
});
