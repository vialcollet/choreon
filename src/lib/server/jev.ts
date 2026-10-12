import type { NoteRoute } from '$lib/types';
import { askClaude } from './agent';
import { secret } from './secrets';

// Annotation routing by Jev (TypeSafe AI, text-only decision model):
// scope (shot fix / storyboard / global style), category, blocking or not.
// Heuristic fallback if the key is missing, if Jev times out or answers badly: an
// annotation never waits for the classifier.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEADLINE_MS = 4000;

const CATEGORIES: Record<string, string> = {
	timing: 'Duration, speed, pacing, sync',
	motion: 'Trajectory, easing, direction or nature of the movement',
	color: 'Colors, contrast',
	typography: 'Font, size or weight of the text',
	layout: 'Composition, position, size, alignment',
	copy: 'Content of the on-screen text or voice-over',
	asset: 'Image, logo, icon, graphic element',
	audio: 'Sound, music, sound effects',
	other: 'Other'
};

// The heuristic matches the user's own notes, which may be written in French or English:
// every pattern accepts both languages.
export function heuristicRoute(body: string, hasTimestamp: boolean): NoteRoute {
	const b = body.toLowerCase();
	const storyboard = /\b(plan suivant|ajoute un plan|supprime (le|ce) plan|inverse|ordre|storyboard|sc[eè]ne enti[eè]re|remplace (le|ce) plan|next shot|add a shot|(remove|delete) (the|this) shot|swap|reorder|order|whole scene|replace (the|this) shot)\b/.test(b);
	const global = /\b(partout|toute la vid[eé]o|tous les plans|toujours|jamais|everywhere|whole video|entire video|all (the )?shots|always|never)\b/.test(b);
	const cat =
		/\b(vite|lent|dur[ée]e|rythme|timing|trop long|trop court|attend|fast|slow|duration|pace|pacing|too long|too short|wait)\b/.test(b) ? 'timing'
		: /\b(couleur|contraste|fonc[eé]|clair|teinte|colou?r|contrast|dark|light|hue|tint)\b/.test(b) ? 'color'
		: /\b(police|typo|gras|taille du texte|font|typeface|bold|text size)\b/.test(b) ? 'typography'
		: /\b(texte|mot|phrase|titre|faute|orthographe|text|word|sentence|title|spelling)\b/.test(b) ? 'copy'
		: /\b(position|align|centr|marge|plus haut|plus bas|gauche|droite|taille|margin|higher|lower|left|right|size)\b/.test(b) ? 'layout'
		: /\b(mouvement|trajectoire|rebond|easing|arriv|sort|glisse|tourne|motion|movement|trajectory|bounce|slide|rotate|spin)\b/.test(b) ? 'motion'
		: /\b(son|musique|bruit|audio|sound|music|sfx)\b/.test(b) ? 'audio'
		: /\b(logo|image|ic[oô]ne|illustration|icon)\b/.test(b) ? 'asset'
		: 'other';
	const lesson: NoteRoute['lesson'] = /(toujours|jamais|partout|charte|marque|logo|always|never|everywhere|brand|guideline)/.test(b) ? (/(charte|marque|logo|couleur|brand|guideline|colou?r)/.test(b) ? 'project' : 'harness') : 'none';
	return { provider: 'heuristic', lesson, scope: storyboard ? 'storyboard_change' : global ? 'global_style' : hasTimestamp ? 'shot_fix' : 'storyboard_change', category: cat, blocking: /\b(bloquant|faux|erreur|cass[eé]|illisible|blocking|blocker|wrong|error|broken|unreadable|illegible)\b/.test(b) };
}

export async function routeNote(opts: { body: string; context: string; hasTimestamp: boolean }): Promise<NoteRoute> {
	const key = secret('TYPESAFE_API_KEY');
	if (!key) return claudeRoute(opts);
	try {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			signal: AbortSignal.timeout(DEADLINE_MS),
			body: JSON.stringify({
				model: 'jev-latest',
				state: `${opts.context}\nUser annotation: "${opts.body}"`,
				questions: {
					scope: {
						type: 'choice',
						instructions: 'What scope of change does this annotation ask for?',
						criteria: {
							shot_fix: 'Local fix of the already-animated shot: timing, position, color, size, motion',
							storyboard_change: 'Change of the intent, the content, the order or the number of shots',
							global_style: 'Style rule valid for the whole video or the whole project'
						}
					},
					category: { type: 'choice', instructions: 'Which aspect is targeted?', criteria: CATEGORIES },
					blocking: { type: 'noul', instructions: 'Does this annotation report a defect that prevents publishing?' },
					lesson: {
						type: 'choice',
						instructions: 'Beyond this shot, what does this annotation reveal?',
						criteria: {
							none: 'Nothing general: a one-off tweak specific to this shot',
							project: 'A deviation from the brand or project identity (colors, logo, tone, typography, guidelines) that could recur elsewhere in this project',
							harness: 'An animation craft or method mistake (legibility, timing, masks, trajectories, rendering) that could recur on any project'
						}
					}
				}
			})
		});
		if (!res.ok) throw new Error(`Jev ${res.status}`);
		const data = (await res.json()) as {
			answers?: Record<string, { choice?: string; confidence?: number; noul?: number }>;
		};
		const a = data.answers ?? {};
		const scope = a.scope?.choice as NoteRoute['scope'] | undefined;
		const category = a.category?.choice;
		if (!scope || !category || typeof a.blocking?.noul !== 'number') throw new Error('incomplete response');
		const lesson = (['none', 'project', 'harness'] as const).find((x) => x === a.lesson?.choice) ?? 'none';
		return { provider: 'jev', scope, category, blocking: a.blocking.noul >= 0.5, confidence: Math.min(a.scope?.confidence ?? 1, a.category?.confidence ?? 1), lesson };
	} catch {
		return claudeRoute(opts);
	}
}

/** Fallback without Jev: the same questions asked to Claude Haiku, then the heuristic. */
async function claudeRoute(opts: { body: string; context: string; hasTimestamp: boolean }): Promise<NoteRoute> {
	try {
		const text = await askClaude(
			`${opts.context}
Annotation: "${opts.body}"

Classify this annotation. Answer with this JSON only:
{"scope": "shot_fix" (local fix of the animated shot: timing, position, colour, size, motion) | "storyboard_change" (intent, content, order or number of shots) | "global_style" (a style rule for the whole video or project),
 "category": one of ${Object.keys(CATEGORIES).join(' | ')},
 "blocking": true if it reports a defect that prevents publishing,
 "lesson": "none" (one-off tweak) | "project" (a deviation from the brand identity that could recur in this project) | "harness" (an animation craft or method mistake that could recur on any project)}`,
			{ model: 'haiku', system: 'You route motion design review notes. Answer with JSON only.', timeoutMs: 15000 }
		);
		const m = /\{[\s\S]*\}/.exec(text);
		const a = m ? (JSON.parse(m[0]) as Partial<NoteRoute>) : null;
		const scope = (['shot_fix', 'storyboard_change', 'global_style'] as const).find((x) => x === a?.scope);
		if (!a || !scope) throw new Error('incomplete response');
		const category = a.category && a.category in CATEGORIES ? a.category : 'other';
		const lesson = (['none', 'project', 'harness'] as const).find((x) => x === a.lesson) ?? 'none';
		return { provider: 'claude', scope, category, blocking: !!a.blocking, lesson };
	} catch {
		return heuristicRoute(opts.body, opts.hasTimestamp);
	}
}
