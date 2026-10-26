// Pure alignment of a storyboard script onto the words a transcript heard (no network, no side effect):
// shared by voice.mjs and its tests. Plain Node ESM.

export const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').trim();
export const tokens = (s) => norm(s).split(/\s+/).filter(Boolean);

// A time is written "8 h" in a script but transcribed "8 heures", "8h" or "8 hours": all read as the token "8h".
const HOUR = /^(h|heures?|hours?|hrs?)$/;
/**
 * Joins a number and the hour unit that follows it into one token ("8" "heures" → "8h"), on normalized words
 * (`list` of objects, `key` names their normalized field). The joined word keeps the first's fields; `merge`
 * combines the two when more must carry over (a heard word's end time).
 */
export function joinTimes(list, key = 'w', merge = (a) => ({ ...a })) {
	const out = [];
	for (let i = 0; i < list.length; i++) {
		const a = list[i], b = list[i + 1];
		const one = /^(\d{1,2})h(\d{2})?$/.exec(a[key]) || /^(\d{1,2})(?:heures?|hours?)$/.exec(a[key]);
		if (one) out.push({ ...a, [key]: `${one[1]}h${one[2] ?? ''}` });
		else if (/^\d{1,2}$/.test(a[key]) && b && HOUR.test(b[key])) { out.push({ ...merge(a, b), [key]: `${a[key]}h` }); i++; }
		else out.push(a);
	}
	return out;
}

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
	const span = [];
	for (let li = 0; li < lines.length; li++) {
		const own = script.map((s, i) => (s.li === li ? i : -1)).filter((i) => i >= 0);
		const idx = own.map((i) => map[i]).filter((x) => x >= 0);
		if (!idx.length) return null;
		span.push({ lo: Math.min(...idx), hi: Math.max(...idx), headLost: map[own[0]] < 0, tailLost: map[own[own.length - 1]] < 0 });
	}
	// A line whose first (last) word was not matched ("Omeon" heard "Hommeon") keeps the unclaimed heard words just
	// before (after) it, as long as the neighbouring line's edge was matched: cutting there would drop speech.
	const bounds = span.map((s, li) => {
		const prev = span[li - 1], next = span[li + 1];
		const lo = s.headLost && (!prev || !prev.tailLost) ? (prev ? prev.hi + 1 : 0) : s.lo;
		const hi = s.tailLost && (!next || !next.headLost) ? (next ? next.lo - 1 : words.length - 1) : s.hi;
		return { lo: Math.min(lo, s.lo), hi: Math.max(hi, s.hi) };
	});
	return lines.map((l, li) => ({ key: l.key, text: l.text.trim(), start: words[bounds[li].lo].t, end: words[bounds[li].hi].end }));
}
