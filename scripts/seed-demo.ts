// Seeds the demo projects. Safe to run again (nothing is overwritten).
//  - « Choreon »: the studio filming itself (identity from seeds/choreon).
//  - « Sorbet » (a fictional brand): identity from seeds/sorbet, a still template (three-scoops) with a
//    launch batch, and ready-to-produce videos with their brief.
//   bun scripts/seed-demo.ts
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../src/lib/server/store';
import { projectDir } from '../src/lib/server/paths';

/** Copies seeds/<slug> into the project workspace (brand first, then extra folders without overwriting edited ones). */
function seedProject(slug: string, name: string, extra: string[] = []) {
	const seed = join(import.meta.dir, '..', 'seeds', slug);
	if (!existsSync(join(projectDir(slug), 'brand', 'motion.md'))) cpSync(seed, projectDir(slug), { recursive: true });
	for (const dir of extra) {
		if (existsSync(join(seed, dir)) && !existsSync(join(projectDir(slug), dir))) cpSync(join(seed, dir), join(projectDir(slug), dir), { recursive: true });
	}
	if (!S.getProject(slug)) S.createProject(name, slug, null, 'en');
	else S.syncWorkspace(slug);
}

seedProject('choreon', 'Choreon');

if (!S.getVideoBySlug('choreon', 'launch-25s')) {
	S.createVideo('choreon', {
		title: 'Choreon — Final cut (25 s)',
		slug: 'launch-25s',
		brief: `A 25-second launch film for Choreon, the open-source AI motion design studio, for X and the GitHub README. The film shows how it was made: it is its own making-of. Follow brand/motion.md ("frame-perfect") and brand/house-rules.md: spectacular through precision and rhythm, cut to a track with a clear beat.

1. The brief (0–5 s): night. A text field types this very brief, "A 25-second launch film for Choreon.", the cursor presses Enter. Hard cut on the beat: "You direct." giant, cropped by the frame, paper on night.
2. The crew (5–14 s): on every beat, the pipeline cuts by — framing questions snap in with their option chips; storyboard cards land on the grid with their beat maps; one card flips into scene.html code scrolling at the frame rate; the code compiles into a contact sheet; the critic draws an annotation box on a frame and the score ticks 6 → 9 in Geist Mono. Hard cut: "Choreon animates."
3. The cut (14–21 s): the timeline assembles the shots clip by clip on the beat, the cue playhead sweeps, the waveform drops in; whip pan into the player, then a split screen of frames from wildly different films (a loud playful brand, a calm editorial one): "Any style."
4. The lockup (21–25 s): the logo arrives as designed (ghost frames on two beats, the key lands, the wordmark cuts in), then the tagline and "Open source · github.com/vialcollet/choreon", held still.

Locked lines: "You direct.", "Choreon animates.", "Any style.", "You direct. Choreon animates.", "Open source · github.com/vialcollet/choreon". Product truth: only what Choreon really does; rebuild its interface from the UI kit in library/ui when there is one. On-screen text in English. 16:9.`,
		format: { width: 1920, height: 1080, fps: 30 },
		targetDuration: 25
	});
}

const P = 'sorbet';
seedProject(P, 'Sorbet (demo)', ['templates', 'stills']);

if (!S.getVideoBySlug(P, 'logo-three-scoops')) {
	S.createVideo(P, {
		title: 'Logo — Three scoops',
		slug: 'logo-three-scoops',
		brief: `A 6-second logo reveal for Sorbet, built from the logo layers in brand/logo.

The three scoops drop in one by one — mint, mango, then raspberry on top — each with a soft, heavy landing (no bounce). When the raspberry scoop lands, the wordmark "sorbet" slides out from behind it, letter by letter, on cream. Hold the full lockup for at least 1.5 s.

Feeling: fresh, confident, a little cheeky. One clean idea, perfectly timed.`,
		format: { width: 1920, height: 1080, fps: 30 },
		targetDuration: 6
	});
}

if (!S.getVideoBySlug(P, 'launch-20s')) {
	S.createVideo(P, {
		title: 'Sorbet — launch film (20 s)',
		slug: 'launch-20s',
		brief: `A 20-second launch film for Sorbet, "a sweeter way to plan your week", for X and LinkedIn.

Story in three beats:
1. The mess (0–6 s): a week view drowning in cards — meetings, tasks, pings — piling up on plum_night. Too much.
2. The scoop (6–14 s): the cursor clicks "Scoop my week". The cards gather into three solid scoops: "What matters" (raspberry), "What's next" (mango), "What can wait" (mint). The background turns cream: relief.
3. The promise (14–20 s): the three scoops become the logo; tagline "A sweeter way to plan your week." Final lockup holds.

Audience: busy team leads. Tone: playful but precise, never "AI magic". On-screen text in English, short and readable on a phone.`,
		format: { width: 1920, height: 1080, fps: 30 },
		targetDuration: 20
	});
}

if (!S.getVideoBySlug(P, 'brain-freeze-20s')) {
	S.createVideo(P, {
		title: 'Sorbet — Brain freeze (20 s)',
		slug: 'brain-freeze-20s',
		brief: `A 20-second showreel-grade film for Sorbet ("a sweeter way to plan your week"). Its only job: be the most spectacular 20 seconds of motion design people see on X this week. Marketing comes second; jaw-drop comes first. Follow brand/house-rules.md and brand/motion.md ("sugar rush"), not restraint.

Concept "Brain freeze", cut to an energetic track with a real drop:
1. The freeze (0–7 s): plum_night. "MONDAY." smashes in, giant, cropped by the frame. The week attacks: meeting cards hail down, pings ricochet, calendar blocks stack into towers that wobble and topple. Every beat a hard colour cut and a new giant word punching in — "MEETINGS." "PINGS." "DEADLINES." The camera dives through it all. Too much, on purpose.
2. The drop (7–14 s): one beat of silence, black frame, a cursor clicks "Scoop my week". Then the drop: a giant raspberry scoop falls from the sky and splats full frame, mango splats, mint splats — sprinkle bursts, drips, jelly wobble. The chaos is swallowed: each scoop carries its words ("What matters", "What's next", "What can wait").
3. The landing (14–20 s): the three scoops bounce into the logo, the camera flies through the "o" of sorbet, the wordmark punches in letter by letter on the beat, then everything settles: the lockup and "A sweeter way to plan your week." held still, the one calm moment.

Locked lines: "Scoop my week", "What matters", "What's next", "What can wait", "A sweeter way to plan your week." On-screen text in English. 16:9.`,
		format: { width: 1920, height: 1080, fps: 30 },
		targetDuration: 20
	});
}

console.log('ok', { choreon: S.listVideos('choreon').map((v) => v.slug), sorbet: S.listVideos(P).map((v) => v.slug) });
