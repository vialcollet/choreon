import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lotDir, pruneRenders } from './stills';

describe('pruneRenders', () => {
	test('removes renders of dropped items and of dropped formats', () => {
		const pid = 'prune-test', slug = 'lot';
		const dir = lotDir(pid, slug);
		mkdirSync(dir, { recursive: true });
		const files = ['A-1080x1350.png', 'A-2400x1500.png', 'B-1080x1350.png', 'lot.json'];
		for (const f of files) writeFileSync(join(dir, f), 'x');
		pruneRenders(pid, { slug, name: slug, template: 't', formats: ['1080x1350'], items: [{ id: 'A', vars: {} }] });
		expect(files.filter((f) => existsSync(join(dir, f)))).toEqual(['A-1080x1350.png', 'lot.json']);
	});
});
