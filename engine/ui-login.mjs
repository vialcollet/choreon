#!/usr/bin/env node
// Manual login to a site (to harvest an interface behind a login): opens a VISIBLE Chromium
// window on the user's screen; they log in, then close the window. The session
// (cookies + local storage) is saved every 2 s, then reused by ui-harvest.mjs.
//   node engine/ui-login.mjs --url https://app.exemple.com --storage <file.json> [--minutes 15]

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
const storage = resolve(a.storage);
mkdirSync(dirname(storage), { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--window-size=1440,960'] });
const context = await browser.newContext({ viewport: null, ...(existsSync(storage) ? { storageState: storage } : {}) });
const page = await context.newPage();
await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
let saved = 0;
const save = async () => {
	try {
		await context.storageState({ path: storage });
		saved++;
	} catch {}
};
const deadline = Date.now() + Number(a.minutes ?? 15) * 60000;
await new Promise((done) => {
	const tick = setInterval(async () => {
		if (!browser.isConnected() || context.pages().length === 0 || Date.now() > deadline) {
			clearInterval(tick);
			return done();
		}
		await save();
	}, 2000);
	browser.on('disconnected', () => {
		clearInterval(tick);
		done();
	});
});
if (browser.isConnected()) await browser.close().catch(() => {});
console.log(JSON.stringify({ storage, saved, ok: saved > 0 && existsSync(storage) }));
