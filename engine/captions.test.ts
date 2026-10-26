import { describe, expect, test } from 'bun:test';
import { assColor, displayWords, groupTimes, groupWords, timeWords, toAss } from './captions.mjs';

const line = (key: string, text: string, start: number, end: number) => ({ key, text, start, end });
const texts = (g: { text: string }[][]) => g.map((x) => x.map((w) => w.text).join(' '));

describe('displayWords', () => {
	test('keeps the hour and lone punctuation with their word', () => {
		expect(displayWords('8 h. Omeon a préparé votre journée : priorités.')).toEqual(['8 h.', 'Omeon', 'a', 'préparé', 'votre', 'journée :', 'priorités.']);
		expect(displayWords('Une question ?')).toEqual(['Une', 'question ?']);
	});
});

describe('timeWords', () => {
	test('times the script words on the heard ones, whatever the transcript wrote', () => {
		const lines = [line('s01', '8 h. Omeon a préparé votre journée.', 0.3, 3.2)];
		const heard = [{ w: '8 heures.', t: 0.3, end: 1.6 }, { w: 'Homeone', t: 1.6, end: 1.9 }, { w: 'a', t: 1.9, end: 2.0 }, { w: 'préparé', t: 2.0, end: 2.4 }, { w: 'votre', t: 2.4, end: 2.6 }, { w: 'journée.', t: 2.6, end: 3.2 }];
		const w = timeWords(lines, heard);
		expect(w.map((x) => x.text)).toEqual(['8 h.', 'Omeon', 'a', 'préparé', 'votre', 'journée.']);
		expect(w.map((x) => x.t)).toEqual([0.3, 1.6, 1.9, 2.0, 2.4, 2.6]);
	});

	test('a word the transcript missed shares the gap between its neighbours', () => {
		const w = timeWords([line('a', 'un deux trois', 0, 3)], [{ w: 'un', t: 0, end: 1 }, { w: 'trois', t: 2, end: 3 }]);
		expect(w[1]).toMatchObject({ text: 'deux', t: 1, end: 2 });
	});

	test('a word missed at the start of a line takes the pause before it, after the previous line', () => {
		const lines = [line('a', 'vos clients.', 33, 34.75), line('b', 'Omeon. Plus de temps.', 36.1, 37.2)];
		const heard = [{ w: 'vos', t: 33, end: 34 }, { w: 'clients.', t: 34, end: 34.75 }, { w: 'Plus', t: 36.1, end: 36.6 }, { w: 'de', t: 36.6, end: 36.8 }, { w: 'temps.', t: 36.8, end: 37.2 }];
		const w = timeWords(lines, heard);
		expect(w[2].text).toBe('Omeon.');
		expect(w[2].t).toBeCloseTo(35.65);
		expect(w[2].end).toBeCloseTo(36.1);
		const tight = timeWords([line('a', 'fin.', 0, 1), line('b', 'Omeon. Plus', 1.1, 2)], [{ w: 'fin.', t: 0, end: 1 }, { w: 'Plus', t: 1.1, end: 2 }]);
		expect(tight[1].t).toBeCloseTo(1);
	});
});

describe('groupWords', () => {
	const ws = (li: number, s: string) => s.split(' ').map((text) => ({ text, li }));

	test('breaks at punctuation and between lines', () => {
		expect(texts(groupWords([...ws(0, 'Une question ?'), ...ws(1, 'Omeon répond.')]))).toEqual(['Une question ?', 'Omeon répond.']);
	});

	test('a long phrase is cut into balanced groups, never over maxWords', () => {
		expect(texts(groupWords(ws(0, 'Omeon a préparé votre journée :')))).toEqual(['Omeon a préparé', 'votre journée :']);
		for (const g of groupWords(ws(0, 'a b c d e f g h i j'), { maxWords: 4, maxChars: 99 })) expect(g.length).toBeLessThanOrEqual(4);
	});
});

describe('toAss', () => {
	test('one event per word, the spoken one in the active colour, shifted to film time', () => {
		const g = groupTimes([[{ text: 'Omeon', li: 0, t: 1, end: 1.4 }, { text: 'répond.', li: 0, t: 1.4, end: 2 }]], { hold: 0.5 });
		expect(g[0]).toMatchObject({ start: 1, end: 2.5 });
		const ass = toAss(g, { width: 1080, height: 1920, family: 'Onest SemiBold', size: 70, y: 1500, color: '#0e172b', active: '#4f7d69', offset: 0.3 });
		const ev = ass.split('\n').filter((l) => l.startsWith('Dialogue'));
		expect(ev).toHaveLength(2);
		expect(ev[0]).toContain('0:00:01.30,0:00:01.70');
		expect(ev[1]).toContain(`Omeon {\\c${assColor('#4f7d69')}`);
		expect(ass).toContain('Style: Caption,Onest SemiBold,70,&H002B170E');
	});
});
