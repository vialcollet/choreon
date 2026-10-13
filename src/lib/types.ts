// Types shared by client/server.

export interface VideoFormat {
	width: number;
	height: number;
	fps: number;
}

/** Content of a storyboard shot (shots.data column). */
export interface ShotData {
	/** What the shot should make the viewer feel/understand — the yardstick for every correction. */
	intent: string;
	/** What is seen: composition, elements, camera movement. */
	visual: string;
	/** On-screen text, word for word. */
	onScreenText?: string;
	/** Optional voice-over. */
	voiceover?: string;
	/** List of timestamped states (seconds relative to the shot): the choreography. */
	beats: { t: number; state: string; cursor?: string; sound?: string }[];
	transitionIn?: string;
	transitionOut?: string;
	sound?: string;
	/** Library elements used (file names or ids). */
	assets?: string[];
	/** Planned method for the reference image: still (rendered HTML) or codex (generated image). */
	refMethod?: 'still' | 'codex';
	refPrompt?: string;
	/** Director's notes applied to the shot: decisions that override the original plan (beats above already reflect them). */
	directorNotes?: string[];
	/** Recorded voice-over, word by word, in seconds relative to the shot start (from the voice track). */
	voiceWords?: { w: string; t: number }[];
}

/** The film's recorded voice-over (one take of the whole script), stored in audio/voice/voice.json. */
export interface VoiceTrack {
	storyboardVersion: number;
	voice: string;
	file: string;
	/** Film time at which the track starts. */
	start: number;
	duration: number;
	words: { w: string; t: number; end: number }[];
	lines: { key: string; text: string; start: number; end: number }[];
	createdAt: number;
	/** The take was cut line by line and each line placed in its shot (shots already animated): `file` starts at film time 0. */
	placed?: boolean;
}

export interface EvalAxis {
	key: string;
	label: string;
	description: string;
	weight: number;
	/** Minimum score (1..10) for the axis to pass. */
	threshold: number;
	/** Axis required to validate the shot. */
	required: boolean;
}

export interface EvalConfig {
	axes: EvalAxis[];
	/** Maximum automatic fix rounds before a human decides. */
	maxRounds: number;
	/** Frames/s of the contact sheet shown to the critic. */
	contactFps: number;
	/** Obsolete: replaced by ProjectSettings.models (critic / animator). Read only to migrate. */
	critic?: { model: string; effort: Effort };
	builder?: { model: string; effort: Effort };
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A question of the framing interview. */
export interface BriefQuestion {
	field: string;
	question: string;
	why: string;
	options?: string[];
	/** The director's proposal if you let them decide. */
	default?: string;
}

/** Framing axis: a decision to make before any storyboard, with typical directions. */
export interface BriefAxis {
	key: string;
	label: string;
	hint: string;
	/** Directions offered in the interview (the director may adjust their wording). */
	suggestions: string[];
}

/** Framing state of a video: the storyboard only starts at "ready". */
export interface BriefState {
	status: 'draft' | 'reviewing' | 'interview' | 'ready';
	/** Decisions made (axis → direction), deduced from the brief or answered. */
	decisions: Record<string, string>;
	/** Axes explicitly dropped for this video (nothing to impose). */
	ignored: string[];
	questions: BriefQuestion[];
	summary?: string;
	reviewedAt?: number;
}

/** Studio agent roles; each has its own model and effort. */
export type Role = 'director' | 'animator' | 'critic' | 'sound' | 'distiller' | 'guide';

export interface ModelChoice {
	model: string;
	effort: Effort;
}

/** studio: a studio-wide role, not overridable per project (the guide talks to the user, not to a project). */
export const ROLES: { key: Role; label: string; hint: string; studio?: boolean }[] = [
	{ key: 'director', label: 'Director', hint: 'Storyboard: generation and revisions' },
	{ key: 'animator', label: 'Animator', hint: 'Shot building and fixes (the “main” one)' },
	{ key: 'critic', label: 'Critic', hint: 'Scored reviews of renders' },
	{ key: 'sound', label: 'Sound designer', hint: 'Placement of sound effects and music' },
	{ key: 'distiller', label: 'Memory', hint: 'Turns notes and recurring flaws into lessons' },
	{ key: 'guide', label: 'Guide', hint: 'The in-app producer you talk to: drives the studio for you', studio: true }
];

export const MODELS: { id: string; label: string }[] = [
	{ id: 'opus', label: 'Opus 5.5' },
	{ id: 'sonnet', label: 'Sonnet 5.5' },
	{ id: 'fable', label: 'Fable 5.1' },
	{ id: 'haiku', label: 'Haiku 5.5' }
];

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ProjectSettings {
	eval: EvalConfig;
	/** Per-role overrides; a missing role takes the studio default. */
	models?: Partial<Record<Role, ModelChoice>>;
	/** Language of the content produced by agents (storyboards, critiques, framing, kits). */
	language?: 'en' | 'fr';
}

export interface StudioSettings {
	models: Record<Role, ModelChoice>;
	/** Proposed lessons become active without human validation. */
	autoApproveLessons: boolean;
	/** Tasks run at the same time (agents + renders), 1 to 8. */
	parallel: number;
	/** Claude authentication for agents: Anthropic API key, Claude Code subscription, or auto (the key if present). */
	claudeAuth: 'auto' | 'subscription' | 'api_key';
	/** Axes of the framing interview (all projects). */
	briefAxes: BriefAxis[];
	/** Voice dictation of input fields (Whisper). */
	dictation: DictationSettings;
}

export type DictationProvider = 'groq' | 'openai';

export interface DictationSettings {
	provider: DictationProvider;
	/** Provider's transcription model. */
	model: string;
	/** Spoken language (ISO 639-1), empty = auto-detect. */
	language: string;
}

export const DICTATION_MODELS: Record<DictationProvider, string[]> = {
	groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
	openai: ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']
};

export type LessonScope = 'harness' | 'project';
export type LessonStatus = 'proposed' | 'active' | 'retired';

export interface Lesson {
	id: string;
	/** Short, stable number (L12) quoted in prompts and by the critic. */
	num: number;
	scope: LessonScope;
	projectId: string | null;
	rule: string;
	rationale: string;
	status: LessonStatus;
	source: { noteIds?: string[]; findings?: string[]; runId?: string; videoId?: string };
	/** Number of agent runs in which the lesson was supplied. */
	uses: number;
	/** Number of times the critic saw it violated. */
	violations: number;
	createdAt: number;
	updatedAt: number;
}

export interface Finding {
	t?: number;
	axis: string;
	severity: 'blocking' | 'major' | 'minor';
	problem: string;
	fix: string;
}

export interface NoteRoute {
	provider: 'jev' | 'claude' | 'heuristic';
	scope: 'shot_fix' | 'storyboard_change' | 'global_style';
	category: string;
	blocking: boolean;
	confidence?: number;
	/** What the note reveals beyond the shot: nothing, a project identity rule, or harness know-how. */
	lesson?: 'none' | 'project' | 'harness';
}

export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunEvent {
	seq: number;
	type: 'status' | 'text' | 'thinking' | 'tool' | 'tool_result' | 'log' | 'error' | 'result' | 'artifact';
	payload: Record<string, unknown>;
	ts: number;
}
