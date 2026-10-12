import type { BriefAxis, EvalConfig, StudioSettings } from '$lib/types';

// Default evaluation grid of a project. Each axis is scored 1..10 by the critic
// (Opus, looking at the render's contact sheets); a shot passes when every required axis reaches
// its threshold. Beyond maxRounds automatic fixes, a human decides.
export const DEFAULT_EVAL: EvalConfig = {
	axes: [
		{
			key: 'intention',
			label: 'Intent',
			description: 'The shot conveys exactly the intent and the states described in the storyboard, in the right order and at the right time.',
			weight: 2,
			threshold: 8,
			required: true
		},
		{
			key: 'mouvement',
			label: 'Motion quality',
			description: 'Physics and easing true to the project’s doctrine (brand/motion.md), no unintended jerks or dead frames, readable trajectories, motion blur that keeps shapes readable.',
			weight: 2,
			threshold: 8,
			required: true
		},
		{
			key: 'marque',
			label: 'Brand compliance',
			description: 'Palette, typefaces and logo compliant with brand/ (DESIGN.md, the logo built from its layers), and the look the doctrine asks for.',
			weight: 2,
			threshold: 8,
			required: true
		},
		{
			key: 'lisibilite',
			label: 'Legibility',
			description: 'The text that carries the message (titles, locked message, and in vertical the text that carries the action) reads at 360 px wide and stays on screen long enough (≥ 2 words/s); ambient interface text only has to be sharp, non-overlapping and recognizable.',
			weight: 1,
			threshold: 8,
			required: true
		},
		{
			key: 'composition',
			label: 'Composition',
			description: 'Clear hierarchy and intentional framing: every crop, overlap or edge contact is chosen, never accidental.',
			weight: 1,
			threshold: 7,
			required: true
		},
		{
			key: 'rythme',
			label: 'Pacing',
			description: 'Cadence true to the brief and the doctrine, a hook within the first 2 seconds if it is the first shot, no dead time nobody chose.',
			weight: 1,
			threshold: 7,
			required: false
		}
	],
	maxRounds: 3,
	contactFps: 4
};

/** Studio settings (all projects). A project can override each role. */
export const DEFAULT_STUDIO: StudioSettings = {
	models: {
		director: { model: 'opus', effort: 'high' },
		animator: { model: 'opus', effort: 'high' },
		critic: { model: 'opus', effort: 'high' },
		sound: { model: 'opus', effort: 'medium' },
		distiller: { model: 'sonnet', effort: 'medium' },
		guide: { model: 'sonnet', effort: 'medium' }
	},
	autoApproveLessons: false,
	parallel: 4,
	claudeAuth: 'auto',
	dictation: { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'fr' },
	get briefAxes() {
		return DEFAULT_BRIEF_AXES;
	}
};

/**
 * Brief axes, required before any storyboard. For each axis, the interview ends with a
 * settled direction or "skipped". The director infers what the brief and the doctrine already decide
 * and asks a question (options drawn from the suggestions) for the rest. Editable in /settings.
 */
export const DEFAULT_BRIEF_AXES: BriefAxis[] = [
	{ key: 'objectif', label: 'Goal', hint: 'What the video must achieve and where it will be published', suggestions: ['Conversion: sign-ups from the landing page', 'Awareness: social media (LinkedIn, X)', 'Sales demo: meetings, trade shows', 'Feature announcement to customers', 'Investors: deck, fundraising'] },
	{ key: 'cible', label: 'Audience', hint: 'Who is watching, and how well they know the product', suggestions: ['Decision-makers who don’t know the product', 'Business users who live the problem', 'Existing customers', 'General public, non-specialists'] },
	{ key: 'message', label: 'Locked message', hint: 'The exact lines on screen or in voice-over, used word for word', suggestions: ['Lines supplied by the user, word for word', 'Reuse the landing page’s headline and subheadline', 'Problem → promise → proof, in 3 short lines'] },
	{ key: 'accroche', label: 'Hook', hint: 'What you see and read in the first second', suggestions: ['The problem, in one sentence that stings', 'The product in action from the very first frame', 'A striking number', 'A question addressed to the viewer'] },
	{ key: 'arc', label: 'Story arc', hint: 'The acts and their duration', suggestions: ['Tension → turn → proof → signature', 'Linear demo: 3 steps of a real user journey', 'Before / after', 'Rhythmic list of benefits'] },
	{ key: 'rythme', label: 'Pacing', hint: 'Cadence of the visual events', suggestions: ['Brisk: one event every 2 to 4 s depending on information density', 'Teaser: under 2 s per event', 'Measured: 4 to 6 s, for a detailed demo'] },
	{ key: 'verite_produit', label: 'Product truth', hint: 'Real features shown, sample data, forbidden promises', suggestions: ['Only the features on the landing page', 'List supplied by the user', 'Real journey of a typical user, credible fictional data'] },
	{ key: 'narration', label: 'Narration', hint: 'What guides the eye: cursor, voice-over, text', suggestions: ['Narrator cursor + sound effects, no voice', 'Voice-over + subtitles', 'On-screen text only', 'Cursor + voice-over'] },
	{ key: 'son', label: 'Sound', hint: 'Music (track, license), sound-effect density', suggestions: ['Sound effects only, synced to picture', 'Library music + sound effects', 'Music supplied later (commercial license)', 'Silent (subtitles, autoplay)'] },
	{ key: 'plan_final', label: 'End shot', hint: 'Last frame: logo, call to action, URL, hold duration', suggestions: ['Logo + URL, held 2 s', 'Logo + call to action + URL', 'Last product screen, then logo'] },
	{ key: 'format', label: 'Format and versions', hint: 'Aspect ratio, versions, safe areas', suggestions: ['16:9 only', '16:9 + 9:16 + 1:1', '9:16 first (social)'] },
	{ key: 'references', label: 'References', hint: 'Films whose grammar to borrow', suggestions: ['References attached to the video', 'Project doctrine only', 'Shortlist references (References page)'] },
	{ key: 'interdits', label: 'Specific bans', hint: 'What is excluded on top of the studio and project rules', suggestions: ['Nothing beyond the project rules', 'No named competitor', 'No unsourced figures'] }
];

export const FORMATS = {
	'16:9': { width: 1920, height: 1080 },
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
	'4:5': { width: 1080, height: 1350 }
} as const;
