import { auth } from './auth';
import { db } from './db';

// Organizations (tenants) and members, on top of better-auth's organization plugin.

export interface OrgRow {
	id: string;
	name: string;
	slug: string;
	role?: string;
}

export const slugify = (x: string) =>
	x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';

export const userCount = () => (db.query('SELECT count(*) AS n FROM user').get() as { n: number }).n;

/** Organizations the user belongs to, with their role. */
export const userOrgs = (userId: string) =>
	db.query('SELECT o.id, o.name, o.slug, m.role FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? ORDER BY o.name').all(userId) as OrgRow[];

export const getOrg = (orgId: string) => db.query('SELECT id, name, slug FROM organization WHERE id = ?').get(orgId) as OrgRow | null;

/** All organizations (admin), with their headcounts and projects. */
export const allOrgs = () =>
	db
		.query(
			`SELECT o.id, o.name, o.slug, o.createdAt,
				(SELECT count(*) FROM member m WHERE m.organizationId = o.id) AS members,
				(SELECT group_concat(p.name, ', ') FROM projects p WHERE p.org_id = o.id) AS projects
			FROM organization o ORDER BY o.name`
		)
		.all() as (OrgRow & { members: number; projects: string | null; createdAt: number })[];

/** Makes an organization active in all of the user's sessions. */
export const activateOrg = (userId: string, orgId: string) => db.query('UPDATE session SET activeOrganizationId = ? WHERE userId = ?').run(orgId, userId);

/** Creates a tenant with its owner (server call, no session). */
export async function createOrg(name: string, ownerId: string) {
	let slug = slugify(name);
	for (let i = 2; db.query('SELECT 1 FROM organization WHERE slug = ?').get(slug); i++) slug = `${slugify(name)}-${i}`;
	const org = await auth.api.createOrganization({ body: { name: name.trim(), slug, userId: ownerId } });
	if (!org) throw new Error('could not create the organization');
	return org;
}

/**
  * Studio's first account: it is admin (signup hook), gets an organization and
  * takes over the projects created before authentication.
 */
export async function bootstrapFirstUser(userId: string, orgName: string) {
	const org = await createOrg(orgName, userId);
	db.query('UPDATE projects SET org_id = ? WHERE org_id IS NULL').run(org.id);
	activateOrg(userId, org.id);
	return org;
}

export interface Invitation {
	id: string;
	email: string;
	role: string;
	status: string;
	expiresAt: number;
	organizationId: string;
	orgName: string;
	inviterName: string | null;
}

export const getInvitation = (invId: string) =>
	db
		.query(
			`SELECT i.id, i.email, i.role, i.status, i.expiresAt, i.organizationId, o.name AS orgName, u.name AS inviterName
			FROM invitation i JOIN organization o ON o.id = i.organizationId LEFT JOIN user u ON u.id = i.inviterId WHERE i.id = ?`
		)
		.get(invId) as Invitation | null;

export const invitationValid = (inv: Invitation | null): inv is Invitation => !!inv && inv.status === 'pending' && new Date(inv.expiresAt).getTime() > Date.now();

/** Accepts an invitation for a user (same address), without going through their session. */
export async function joinByInvitation(userId: string, email: string, invId: string) {
	const inv = getInvitation(invId);
	if (!invitationValid(inv)) throw new Error('invitation expired or already used');
	if (inv.email.toLowerCase() !== email.toLowerCase()) throw new Error(`this invitation is for ${inv.email}`);
	const already = db.query('SELECT 1 FROM member WHERE userId = ? AND organizationId = ?').get(userId, inv.organizationId);
	if (!already) await auth.api.addMember({ body: { userId, organizationId: inv.organizationId, role: inv.role as 'member' } });
	db.query("UPDATE invitation SET status = 'accepted' WHERE id = ?").run(invId);
	activateOrg(userId, inv.organizationId);
	return inv;
}

/** Pending members and invitations of an organization. */
export function orgPeople(orgId: string) {
	const members = db
		.query('SELECT m.id, m.role, m.createdAt, u.id AS userId, u.name, u.email FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ? ORDER BY m.createdAt')
		.all(orgId) as { id: string; role: string; createdAt: number; userId: string; name: string; email: string }[];
	const invitations = db
		.query("SELECT id, email, role, expiresAt FROM invitation WHERE organizationId = ? AND status = 'pending' ORDER BY expiresAt DESC")
		.all(orgId) as { id: string; email: string; role: string; expiresAt: number }[];
	return { members, invitations: invitations.filter((i) => new Date(i.expiresAt).getTime() > Date.now()) };
}
