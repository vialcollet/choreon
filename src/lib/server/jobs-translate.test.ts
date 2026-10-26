import { afterAll, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shotDir, videoDir } from './paths';
import * as S from './store';

// video_translate end to end, the agents replaced: the localizer writes its draft, the shot fixes stop at once.
const realAgent = await import('./agent');
const tasks: { prompt: string; lang?: string }[] = [];
let draft: unknown = null;
mock.module('./agent', () => ({
	...realAgent,
	runAgent: async (task: { prompt: string; cwd: string; lang?: string }) => {
		tasks.push(task);
		const m = /`(videos\/[^`]+\/storyboard\/draft\.json)`/.exec(task.prompt);
		if (!m || !draft) throw new Error('agent stopped');
		writeFileSync(join(task.cwd, m[1]), JSON.stringify(draft));
		return { text: 'done', texts: ['done'], cost: 0 };
	}
}));
const { enqueue } = await import('./jobs');
afterAll(() => mock.module('./agent', () => realAgent));

const finished = async (id: string) => {
	for (let i = 0; i < 300; i++) {
		const r = S.getRun(id)!;
		if (r.status !== 'queued' && r.status !== 'running') return r;
		await Bun.sleep(10);
	}
	throw new Error('run never finished');
};

const project = S.createProject('Translate', 'translate-test', null, 'fr');
const source = S.createVideo(project.id, { title: 'Une journée', brief: 'Un film', format: { width: 1080, height: 1920, fps: 30 }, targetDuration: 6, slug: 'une-journee' });
const beats = [{ t: 0, state: 'vide', cursor: '', sound: '' }, { t: 1, state: 'la carte', cursor: '', sound: '' }];
const vdir = videoDir(project.id, source.slug);
const lib = join(vdir, 'storyboard', 'refs', 'v1', '_lib');
mkdirSync(lib, { recursive: true });
writeFileSync(join(lib, 'app.js'), "export const LABELS = ['Tâches'];");
writeFileSync(join(vdir, 'storyboard', 'refs', 'v1', 's01.png'), 'png');
for (const key of ['s01', 's02']) {
	const dir = shotDir(project.id, source.slug, key);
	mkdirSync(join(dir, 'renders'), { recursive: true });
	writeFileSync(join(dir, 'scene.html'), `<script type="module">import { LABELS } from '/project/videos/une-journee/storyboard/refs/v1/_lib/app.js';</script>`);
	writeFileSync(join(dir, 'renders', 'r001.mp4'), 'mp4');
}
mkdirSync(join(vdir, 'audio'), { recursive: true });
writeFileSync(join(vdir, 'audio', 'cues-musique.json'), '{"cues":[]}');
const sb = S.createStoryboard(source.id, {
	logline: 'La journée',
	summary: 'Deux plans',
	shots: [
		{ key: 's01', title: 'Matin', duration: 3, data: { intent: 'i', visual: 'v', onScreenText: '8 h', voiceover: '8 h. Bonjour.', beats, voiceWords: [{ w: '8', t: 0.3 }] }, refImage: join(vdir, 'storyboard', 'refs', 'v1', 's01.png') },
		{ key: 's02', title: 'Fin', duration: 3, data: { intent: 'i', visual: 'v', beats } }
	]
}, null);
S.setStoryboardStatus(sb.id, 'approved');
const en = {
	title: 'A day',
	brief: 'A film',
	logline: 'The day',
	summary: 'Two shots',
	shots: [
		{ key: 's01', title: 'Morning', intent: 'i', visual: 'v', onScreenText: '8 AM', voiceover: '8 a.m. Hello.', beats: [{ state: 'empty' }, { state: 'the card' }] },
		{ key: 's02', title: 'End', intent: 'i', visual: 'v', beats: [{ state: 'empty' }, { state: 'the card' }] }
	]
};

describe('video_translate', () => {
	test('a film not fully animated is refused before anything is copied', async () => {
		const bare = S.createVideo(project.id, { title: 'Bare', brief: '', format: { width: 1920, height: 1080, fps: 30 }, targetDuration: 3 });
		S.createStoryboard(bare.id, { logline: '', summary: '', shots: [{ key: 's01', title: 'x', duration: 3, data: { intent: '', visual: '', beats: [] } }] }, null);
		const run = await finished(enqueue('video_translate', { projectId: project.id, videoId: bare.id, lang: 'en' }).id);
		expect(run.error).toContain('animate every shot');
		expect(existsSync(videoDir(project.id, 'bare-en'))).toBe(false);
		const same = await finished(enqueue('video_translate', { projectId: project.id, videoId: source.id, lang: 'fr' }).id);
		expect(same.error).toContain('already in French');
	});

	test('a failed translation leaves no film behind', async () => {
		draft = null;
		const run = await finished(enqueue('video_translate', { projectId: project.id, videoId: source.id, lang: 'en' }).id);
		expect(run.error).toBe('agent stopped');
		expect(S.getVideoBySlug(project.id, 'une-journee-en')).toBeNull();
	});

	test('makes the same film in English: scenes, shared code and cues copied and repointed, the plan translated', async () => {
		draft = en;
		tasks.length = 0;
		const run = await finished(enqueue('video_translate', { projectId: project.id, videoId: source.id, lang: 'en', title: 'Translation · en' }).id);
		expect(run.status).toBe('done');
		expect(tasks[0].lang).toBe('en');
		expect(tasks[0].prompt).toContain('videos/une-journee-en/storyboard/refs/v1/_lib/app.js');
		const v = S.getVideoBySlug(project.id, 'une-journee-en')!;
		expect(v).toMatchObject({ title: 'A day', brief: 'A film', language: 'en', format: source.format });
		const nsb = S.getStoryboard(v.id)!;
		expect(nsb.status).toBe('approved');
		const shots = S.listShots(nsb.id);
		expect(shots.map((s) => [s.key, s.title, s.duration])).toEqual([['s01', 'Morning', 3], ['s02', 'End', 3]]);
		expect(shots[0].data).toMatchObject({ onScreenText: '8 AM', voiceover: '8 a.m. Hello.' });
		expect(shots[0].data.voiceWords).toBeUndefined();
		expect(shots[0].data.beats.map((b) => [b.t, b.state])).toEqual([[0, 'empty'], [1, 'the card']]);
		const ndir = videoDir(project.id, v.slug);
		expect(shots[0].refImage).toBe(join(ndir, 'storyboard', 'refs', 'v1', 's01.png'));
		expect(readFileSync(join(shotDir(project.id, v.slug, 's01'), 'scene.html'), 'utf8')).toContain("'/project/videos/une-journee-en/storyboard/refs/v1/_lib/app.js'");
		expect(existsSync(join(ndir, 'storyboard', 'refs', 'v1', '_lib', 'app.js'))).toBe(true);
		expect(existsSync(join(ndir, 'audio', 'cues-musique.json'))).toBe(true);
		expect(existsSync(join(shotDir(project.id, v.slug, 's01'), 'renders'))).toBe(false);
		// The source is untouched, and the new film's take counts as animated (a voice-over is placed in the shots).
		expect(readFileSync(join(shotDir(project.id, source.slug, 's01'), 'scene.html'), 'utf8')).toContain('/videos/une-journee/storyboard');
		expect(S.takeIsTranslation(v.id)).toBe(true);
		// Then each shot is translated on its own, in the new film.
		await Bun.sleep(50);
		const fixes = S.listRuns({ videoId: v.id }).filter((r) => r.kind === 'shot_fix');
		expect(fixes.map((r) => r.input.shotKey).sort()).toEqual(['s01', 's02']);
		expect(String(fixes[0].input.direction)).toContain('Translate this shot into English');
		for (const f of fixes) await finished(f.id);
	});
});
