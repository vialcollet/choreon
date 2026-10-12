# Third-party software and assets

Choreon's own code is released under the [MIT License](LICENSE). It depends on, bundles or downloads the following third-party components, each under its own terms.

## Bundled in this repository

| Component | Where | License |
|---|---|---|
| Kenney — Interface Sounds, UI Audio | `engine/sfx-bank/kenney-*` | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (see each `License.txt`) |
| Bricolage Grotesque | `seeds/sorbet/brand/fonts` | [SIL Open Font License 1.1](seeds/sorbet/brand/fonts/OFL-BricolageGrotesque.txt) |
| Inter | `seeds/sorbet/brand/fonts` | [SIL Open Font License 1.1](seeds/sorbet/brand/fonts/OFL-Inter.txt) |
| Geist, Geist Mono | `seeds/choreon/brand/fonts`, `static/fonts` | [SIL Open Font License 1.1](seeds/choreon/brand/fonts/OFL-Geist.txt) |
| Instrument Serif | `seeds/choreon/brand/fonts` | [SIL Open Font License 1.1](seeds/choreon/brand/fonts/OFL-InstrumentSerif.txt) |

**Sorbet** (`seeds/sorbet`) is a fictional brand created for the demo. Its logo and guidelines, like Choreon's own identity (`seeds/choreon`, `static/favicon.svg`), are part of this repository and covered by the MIT License.

## npm dependencies (installed, not bundled)

| Package | License | Note |
|---|---|---|
| [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0-or-later | Downloads an **FFmpeg** binary built with GPL components. Choreon runs it as a separate program (renders, assembly, sound mix); it is not linked into Choreon. If you redistribute that binary, the GPL applies to it. You can use your own FFmpeg instead. |
| [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Anthropic terms | Use is governed by Anthropic's [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) (API key) or your Claude plan's terms (subscription). |
| [`playwright`](https://github.com/microsoft/playwright) | Apache-2.0 | Headless Chromium for frame rendering and UI harvesting. |
| [`better-auth`](https://github.com/better-auth/better-auth) | MIT | |
| [`@lucide/svelte`](https://github.com/lucide-icons/lucide) | ISC | |
| [`marked`](https://github.com/markedjs/marked) | MIT | |
| SvelteKit, Svelte, Vite | MIT | |

## Optional downloads (not in this repository)

| Source | Script | License |
|---|---|---|
| **Mixkit** sound effects and music | `node engine/sfx-bank/fetch-mixkit.mjs` | [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree) and [Mixkit Stock Music Free License](https://mixkit.co/license/#musicFree). Free for commercial use without attribution; the music license excludes TV/radio broadcast, physical media and video games. **The files may not be redistributed on their own**, which is why they are downloaded into `data/` (git-ignored) instead of being shipped. |

## External services (bring your own key)

Anthropic (Claude), and optionally Groq or OpenAI (dictation) and Jev (note routing). Each is used under its provider's terms; Choreon never ships or shares keys.
