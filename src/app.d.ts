import type { Session } from '$lib/server/auth';
import type { Lang } from '$lib/i18n';

declare global {
	namespace App {
		interface Locals {
			user: (Session['user'] & { role?: string | null }) | null;
			session: (Session['session'] & { activeOrganizationId?: string | null }) | null;
			/** Interface language: `lang` cookie, otherwise the browser's language. */
			lang: Lang;
		}
	}
}

export {};
