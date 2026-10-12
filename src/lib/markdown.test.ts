import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from './markdown';

/** href and src values found in the HTML. */
const urls = (html: string) => [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
const unsafe = /javascript|vbscript|data:/i;

describe('renderMarkdown: unsafe URLs', () => {
	const links: Record<string, string> = {
		javascript: '[x](javascript:alert(1))',
		'mixed case': '[x](JaVaScRiPt:alert(1))',
		'leading space': '[x]( javascript:alert(1))',
		'leading space in angle brackets': '[x](< javascript:alert(1)>)',
		'numeric entity': '[x](&#106;avascript:alert(1))',
		'hex entity': '[x](&#x6A;avascript:alert(1))',
		'entity colon': '[x](javascript&colon;alert(1))',
		'entity tab': '[x](java&Tab;script:alert(1))',
		'control char': '[x](<java\u0001script:alert(1)>)',
		data: '[x](data:text/html,<script>alert(1)</script>)',
		vbscript: '[x](vbscript:msgbox(1))',
		autolink: '<javascript:alert(1)>',
		reference: '[x][1]\n\n[1]: javascript:alert(1)',
		file: '[x](file:///etc/passwd)'
	};
	for (const [name, src] of Object.entries(links))
		test(`link: ${name}`, () => {
			const html = renderMarkdown(src);
			expect(urls(html).filter((u) => unsafe.test(u) || /^file:/i.test(u))).toEqual([]);
			expect(html).not.toContain('<a');
		});

	test('a rejected link keeps its text, escaped', () => {
		expect(renderMarkdown('[1 < 2 & "q"](javascript:alert(1))')).toBe('<p>1 &lt; 2 &amp; &quot;q&quot;</p>\n');
	});

	test('a rejected link keeps its inline formatting', () => {
		expect(renderMarkdown('[**bold** `code`](javascript:alert(1))')).toBe('<p><strong>bold</strong> <code>code</code></p>\n');
	});

	test('image with an unsafe src renders its alt text only', () => {
		for (const src of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'JAVASCRIPT:alert(1)']) {
			const html = renderMarkdown(`![a "<i>" alt](${src})`);
			expect(html).not.toContain('<img');
			expect(urls(html)).toEqual([]);
			expect(html).toBe('<p>a &quot;&lt;i&gt;&quot; alt</p>\n');
		}
	});

	test('a title cannot break out of the attribute', () => {
		const html = renderMarkdown('[x](https://a.com "t\\" onmouseover=\\"alert(1)")');
		// once the quoted values are removed, only the two attribute names remain
		expect(/<a ([^>]*)>/.exec(html)![1].replace(/"[^"]*"/g, '""')).toBe('href="" title=""');
	});
});

describe('renderMarkdown: allowed content', () => {
	test('keeps http, https, mailto, relative and anchor links', () => {
		for (const u of ['http://a.com/x?y=1', 'https://a.com', 'mailto:me@a.com', '/files/projects/p/a.png', 'a/b.md', './a', '../a', '#section', 'HTTPS://A.COM'])
			expect(urls(renderMarkdown(`[x](${u})`))).toEqual([u]);
	});

	test('keeps a safe image and an autolink', () => {
		expect(urls(renderMarkdown('![alt](https://a.com/i.png)'))).toEqual(['https://a.com/i.png']);
		expect(urls(renderMarkdown('![alt](/files/projects/p/i.png)'))).toEqual(['/files/projects/p/i.png']);
		expect(urls(renderMarkdown('<https://a.com>'))).toEqual(['https://a.com']);
		expect(urls(renderMarkdown('see https://a.com/x now'))).toEqual(['https://a.com/x']);
	});

	test('renders ordinary markdown as before', () => {
		expect(renderMarkdown('# T\n\n- a\n- b\n\n*em* **st** `c`\n\n```\ncode\n```')).toBe(
			'<h1>T</h1>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<p><em>em</em> <strong>st</strong> <code>c</code></p>\n<pre><code>code\n</code></pre>\n'
		);
		expect(renderMarkdown('[x](https://a.com "ti")')).toBe('<p><a href="https://a.com" title="ti">x</a></p>\n');
	});

	test('drops raw HTML', () => {
		expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('script');
		expect(renderMarkdown('a <img src=x onerror=alert(1)> b')).not.toContain('<img');
		expect(renderMarkdown('<div onclick="x()">hi</div>')).not.toContain('onclick');
	});

	test('empty input', () => {
		expect(renderMarkdown('')).toBe('');
	});
});
