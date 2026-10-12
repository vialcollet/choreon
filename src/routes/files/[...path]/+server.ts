import { statSync, createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { translate } from '$lib/i18n';
import { canAccessProject } from '$lib/server/access';
import { FILE_HEADERS, resolveProjectFile } from '$lib/server/paths';
import type { RequestHandler } from './$types';

// Files of the projects (renders, sheets, library, identity). Read-only, confined to
// projects/<pid>/ (no dotfile, no ui-auth, symlinks resolved) and to the projects the user can
// open; handles Range requests so the video is seekable.

const MIME: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
	'.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/plain; charset=utf-8',
	'.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2'
};

export const GET: RequestHandler = ({ params, request, locals }) => {
	const hit = resolveProjectFile(params.path);
	if (!hit || !canAccessProject(locals, hit.projectId)) return new Response(translate(locals.lang, 'not found'), { status: 404, headers: { ...FILE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
	const file = hit.abs;
	const size = statSync(file).size;
	const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
	const range = request.headers.get('range');
	const base = { ...FILE_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
	if (range) {
		const m = /bytes=(\d*)-(\d*)/.exec(range);
		const start = m?.[1] ? Number(m[1]) : 0;
		const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
		const stream = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
		return new Response(stream, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
	}
	return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, { headers: { ...base, 'Content-Length': String(size) } });
};
