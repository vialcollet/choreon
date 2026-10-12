# Contributing

Thanks for helping. Choreon is a local-first studio; keep changes small and focused.

## Setup

Requirements: [Bun](https://bun.sh) ≥ 1.3 and Node ≥ 22.

```bash
bun install
npx playwright install chromium    # bare Linux: npx playwright install --with-deps chromium
bun run dev                        # http://localhost:5610
```

## Before a pull request

- `bun run check` must report 0 errors and 0 warnings. The "svelte.config.js is ignored" line it prints is expected (the kit options live in `vite.config.ts`).
- `bun test` must pass. The suite runs offline, needs no API key and never calls a paid API; keep it that way (stub the network, use the temp data dir set up in `src/test-setup.ts`).
- New behavior comes with a test next to its module (`*.test.ts`, `bun:test`).

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), in English (`fix(paths): reject symlinks out of the project`).
- Every UI string goes through the i18n helpers (`t()`), with a French entry in `src/lib/i18n/fr/`.
- Code and comments are in English.

## Security

Do not open a public issue for a vulnerability. Report it privately as described in [SECURITY.md](SECURITY.md).
