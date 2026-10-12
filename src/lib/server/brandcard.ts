import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileUrl, projectDir } from './paths';
import * as S from './store';

/**
 * What the UI shows of a brand: the full logo (brand.json logo.full, or brand/logo/logo.svg), the
 * plate it sits on (logo.plate, light by default) and the palette.
 */
export function brandCard(pid: string) {
	const brand = S.readBrand(pid);
	const logo = brand.json.logo ?? {};
	const fallback = join(projectDir(pid), 'brand', 'logo', 'logo.svg');
	const file = logo.full ? join(projectDir(pid), String(logo.full).replace(/^\/project\//, '')) : existsSync(fallback) ? fallback : null;
	return {
		logoUrl: file && existsSync(file) ? fileUrl(file) : null,
		plate: typeof logo.plate === 'string' ? logo.plate : '#f6f7f9',
		colors: (brand.json.colors ?? {}) as Record<string, string>,
		fonts: (brand.json.fonts ?? {}) as Record<string, { family: string }>,
		tagline: typeof brand.json.tagline === 'string' ? brand.json.tagline : '',
		hasMotion: brand.motion.length > 80
	};
}
