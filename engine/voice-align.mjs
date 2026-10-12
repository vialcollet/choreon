// Pure alignment of a storyboard script onto the words a transcript heard (no network, no side effect):
// shared by voice.mjs and its tests. Plain Node ESM.

export const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').trim();
export const tokens = (s) => norm(s).split(/\s+/).filter(Boolean);

function lev(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[a.length][b.length];
}
// Brand names are often misheard ("Choreon" → "Corian"): a close spelling counts as a match.
export const close = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && lev(a, b) <= Math.max(2, Math.floor(Math.max(a.length, b.length) * 0.45)));

/** Global alignment (Needleman-Wunsch) of the script's words onto the heard words: index of the heard word per script word, or -1. */
export function align(script, heard) {
	const n = script.length, m = heard.length;
	const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
	const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
	for (let i = 1; i <= n; i++) { S[i][0] = -i; B[i][0] = 1; }
	for (let j = 1; j <= m; j++) { S[0][j] = -j; B[0][j] = 2; }
	for (let i = 1; i <= n; i++)
		for (let j = 1; j <= m; j++) {
			const a = script[i - 1], b = heard[j - 1];
			const diag = S[i - 1][j - 1] + (a === b ? 2 : close(a, b) ? 1 : -1);
			const up = S[i - 1][j] - 1, left = S[i][j - 1] - 1;
			if (diag >= up && diag >= left) { S[i][j] = diag; B[i][j] = 0; }
			else if (up >= left) { S[i][j] = up; B[i][j] = 1; }
			else { S[i][j] = left; B[i][j] = 2; }
		}
	const map = new Array(n).fill(-1);
	let i = n, j = m;
	while (i > 0 || j > 0) {
		const b = i > 0 && j > 0 ? B[i][j] : i > 0 ? 1 : 2;
		if (b === 0) { if (close(script[i - 1], heard[j - 1])) map[i - 1] = j - 1; i--; j--; }
		else if (b === 1) i--;
		else j--;
	}
	return map;
}

/**
 * Each line with the start of its first aligned word and the end of its last: `lines` are { key, text }, `script`
 * the lines' words ({ w, li }: li is the index of the line), `words` the heard words ({ w, t, end }, the ones
 * `map` indexes) and `map` the result of `align`. Null when a line has no aligned word at all: the take does not
 * read that line and must not be kept.
 */
export function placeLines(lines, script, words, map) {
	const out = [];
	for (let li = 0; li < lines.length; li++) {
		const idx = script.map((s, i) => (s.li === li ? map[i] : -1)).filter((x) => x >= 0);
		if (!idx.length) return null;
		out.push({ key: lines[li].key, text: lines[li].text.trim(), start: words[Math.min(...idx)].t, end: words[Math.max(...idx)].end });
	}
	return out;
}
