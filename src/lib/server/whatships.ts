import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ensureDir } from './paths';

// whatships.com client: public catalog (MIT) of startup launch videos posted
// on X. The full index is cached for 24 h; each video page carries a VideoObject JSON-LD
// with the MP4 URL (video.twimg.com, behind their proxy), the duration and the original X post.

const BASE = 'https://whatships.com';
const CACHE = () => join(ensureDir(join(DATA_DIR, 'cache')), 'whatships-index.json');

export interface WsItem {
	slug: string;
	name: string;
	company: string;
	category: string;
	poster: string;
	href: string;
	text: string;
}

export interface WsDetail extends WsItem {
	description: string;
	videoUrl: string | null;
	duration: number | null;
	uploadDate: string | null;
	xUrl: string | null;
}

export async function wsIndex(force = false): Promise<WsItem[]> {
	const file = CACHE();
	if (!force && existsSync(file) && Date.now() - statSync(file).mtimeMs < 24 * 3600 * 1000) return JSON.parse(readFileSync(file, 'utf8'));
	const res = await fetch(`${BASE}/search-index.json`, { signal: AbortSignal.timeout(30000) });
	if (!res.ok) throw new Error(`whatships: index ${res.status}`);
	const raw = (await res.json()) as Array<Record<string, string>>;
	const items: WsItem[] = raw
		.filter((x) => x.kind === 'video')
		.map((x) => {
			const [company, category] = String(x.meta ?? '').split(' · ');
			return { slug: x.slug, name: x.name, company: company ?? '', category: category ?? 'Other', poster: `${BASE}${x.poster ?? ''}`, href: `${BASE}${x.href}`, text: x.searchText ?? '' };
		});
	writeFileSync(file, JSON.stringify(items));
	return items;
}

/** Full-text search (all words) + category filter. */
export async function wsSearch(q: string, category?: string, limit = 60): Promise<WsItem[]> {
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	return (await wsIndex())
		.filter((x) => !category || x.category === category)
		.filter((x) => words.every((w) => x.text.includes(w) || x.name.toLowerCase().includes(w)))
		.slice(0, limit);
}

const PT = (s: string) => {
	const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s);
	return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
};

export async function wsDetail(slug: string): Promise<WsDetail> {
	const item = (await wsIndex()).find((x) => x.slug === slug);
	const res = await fetch(`${BASE}/videos/${slug}/`, { signal: AbortSignal.timeout(30000) });
	if (!res.ok) throw new Error(`whatships: page ${slug} ${res.status}`);
	const html = await res.text();
	const pick = (re: RegExp) => re.exec(html)?.[1] ?? null;
	const content = pick(/"contentUrl":"([^"]+)"/);
	let videoUrl: string | null = null;
	if (content) {
		try {
			videoUrl = new URL(content).searchParams.get('url') ?? content;
		} catch {
			videoUrl = content;
		}
	}
	const desc = pick(/<meta name="description" content="([^"]*)"/) ?? pick(/"description":"([^"]*)"/) ?? '';
	const duration = pick(/"duration":"([^"]+)"/);
	return {
		...(item ?? { slug, name: slug, company: '', category: '', poster: '', href: `${BASE}/videos/${slug}/`, text: '' }),
		description: desc,
		videoUrl,
		duration: duration ? PT(duration) : null,
		uploadDate: pick(/"uploadDate":"([^"]+)"/),
		xUrl: pick(/(https:\/\/x\.com\/[^"/]+\/status\/\d+)/)
	};
}

export const WS_CATEGORIES = ['Motion', 'Design', 'Productivity', 'AI', 'Developer tools', 'Consumer', 'Hardware', 'Other'];
