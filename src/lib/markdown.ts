import { Marked } from 'marked';

// Markdown produced by our agents. Raw HTML is dropped, and a link or image URL is kept only
// for http, https, mailto, a relative path or an #anchor (no DOM needed, so it works in SSR).
// A rejected link renders its text, a rejected image its alt text.

const SCHEMES = new Set(['http', 'https', 'mailto']);
const NAMED: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', nbsp: ' ' };

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** True when the URL has no scheme, or an allowed one (checked as a browser would read it). */
function safeUrl(href: string): boolean {
	const url = href
		.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
		.replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
		.replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
		// browsers drop tabs, newlines and leading control characters inside a URL
		.replace(/[\u0000-\u0020\u007f-\u00a0\u2028\u2029]/g, '')
		.toLowerCase();
	const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url)?.[1];
	return !scheme || SCHEMES.has(scheme);
}

const md = new Marked({
	gfm: true,
	renderer: {
		html: () => '',
		// returning false keeps marked's own rendering (and its escaping) for a safe URL
		link(token) {
			return safeUrl(token.href) ? false : this.parser.parseInline(token.tokens);
		},
		image(token) {
			return safeUrl(token.href) ? false : escape(token.text);
		}
	}
});

export const renderMarkdown = (text: string): string => md.parse(text ?? '', { async: false }) as string;
