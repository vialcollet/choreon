/**
  * Reads a JSON body as UTF-8; if it isn't valid UTF-8 (curl from a Windows console,
  * which sends Windows-1252), decodes it as Windows-1252 rather than storing "�".
 */
export async function readJson<T = Record<string, any>>(request: Request): Promise<T> {
	const buf = await request.arrayBuffer();
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
	} catch {
		text = new TextDecoder('windows-1252').decode(buf);
	}
	return JSON.parse(text) as T;
}
