// Resets an account's password, locally (no email):
//   bun scripts/reset-password.ts <email>              → generates a password and prints it
//   bun scripts/reset-password.ts <email> --ask        → asks for it at the keyboard (hidden input)
// All of the account's sessions are closed. Run in a terminal, not via an agent:
// the password must only appear on your screen.
import { Database } from 'bun:sqlite';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';

const [email, flag] = process.argv.slice(2);
if (!email) {
	console.error('usage : bun scripts/reset-password.ts <email> [--ask]');
	process.exit(1);
}

const dataDir = resolve(process.env.STUDIO_DATA || join(import.meta.dir, '..', 'data'));
const db = new Database(join(dataDir, 'studio.db'));
const user = db.query('SELECT id, name FROM user WHERE lower(email) = lower(?)').get(email) as { id: string; name: string } | null;
if (!user) {
	const known = (db.query('SELECT email FROM user ORDER BY createdAt').all() as { email: string }[]).map((u) => u.email);
	console.error(`No account for ${email}. Existing accounts: ${known.join(', ') || 'none'}`);
	process.exit(1);
}

/** Hidden input (the terminal doesn't echo typed characters). */
// "data" listener rather than an iterator: leaving a `for await` destroys stdin, which
// made the confirmation prompt fail (AbortError).
// Whatever was typed beyond the current line is kept for the next prompt.
let pending = '';
function ask(label: string): Promise<string> {
	return new Promise((done) => {
		const stdin = process.stdin;
		process.stdout.write(label);
		let out = '';
		const consume = (): boolean => {
			while (pending.length) {
				const c = pending[0];
				pending = pending.slice(1);
				if (c === '\r' || c === '\n') {
					if (c === '\r' && pending[0] === '\n') pending = pending.slice(1);
					return true;
				}
				if (c === '\u0003') process.exit(130);
				if (c === '\u007f' || c === '\b') out = out.slice(0, -1);
				else out += c;
			}
			return false;
		};
		const finish = () => {
			stdin.off('data', onData);
			stdin.setRawMode?.(false);
			stdin.pause();
			process.stdout.write('\n');
			done(out);
		};
		const onData = (chunk: Buffer) => {
			pending += chunk.toString('utf8');
			if (consume()) finish();
		};
		if (consume()) return finish();
		stdin.setRawMode?.(true);
		stdin.on('data', onData);
		stdin.resume();
	});
}

let password: string;
if (flag === '--ask') {
	password = await ask('New password (10 characters minimum): ');
	if (password.length < 10) {
		console.error('Too short: 10 characters minimum.');
		process.exit(1);
	}
	if ((await ask('Confirme : ')) !== password) {
		console.error('The two entries differ.');
		process.exit(1);
	}
} else {
	password = randomBytes(18).toString('base64url');
}

const hash = await hashPassword(password);
const n = db.query("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").run(hash, new Date().toISOString(), user.id).changes;
if (!n) db.query("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)").run(randomBytes(16).toString('hex'), user.id, user.id, hash, new Date().toISOString(), new Date().toISOString());
const closed = db.query('DELETE FROM session WHERE userId = ?').run(user.id).changes;

console.log(`Password for ${user.name} <${email}> reset; ${closed} session(s) closed.`);
if (flag !== '--ask') console.log(`New password: ${password}\nSave it in Bitwarden, then change it from "My account" if you like.`);
