// Production start: listen on the IPv4 loopback unless HOST says otherwise (adapter-node defaults to 0.0.0.0).
import { createServer } from 'node:http';

const host = (process.env.HOST ||= '127.0.0.1');
const port = Number(process.env.PORT || 3000);
// Without ORIGIN, adapter-node takes every request for https, so SvelteKit refuses the forms of a plain-http
// studio as cross-site (even the first sign-up). Unless ORIGIN is set, a request's origin is the address the
// browser used, over http unless a reverse proxy says https (X-Forwarded-Proto).
if (!process.env.ORIGIN) process.env.PROTOCOL_HEADER ||= 'x-forwarded-proto';
const proto = process.env.PROTOCOL_HEADER?.toLowerCase();

const { handler } = await import('../build/handler.js');
createServer((req, res) => {
	if (!process.env.ORIGIN && proto && !req.headers[proto]) req.headers[proto] = 'http';
	handler(req, res, () => {
		res.statusCode = 404;
		res.end();
	});
}).listen(port, host, () => console.log(`Listening on http://${host}:${port}`));
