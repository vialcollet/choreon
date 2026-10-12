# Security

## Security model

Choreon is a **local, single-operator studio**. Its agents run Claude Code with full tool access
(shell, file system) under the server's OS user, on the machine that hosts the studio. They read
content you import (briefs, references, harvested web pages), so a prompt injection in that content
can run commands. Treat every account as trusted, and do not expose the studio to the internet; if
you must reach it remotely, put it behind a VPN or an authenticated reverse proxy. Organizations
organize projects; they are not an isolation boundary between untrusted users.

## Known limits

- **No agent sandbox.** Agents are not run in a container or a restricted environment. This is a
  planned hardening. Until then, an agent can do anything the server's OS user can do.
- **Network exposure.** `bun run start` listens on `127.0.0.1` by default. Set `HOST` (for example
  `HOST=0.0.0.0`) to expose it. Create the first account locally first: the first account becomes
  the studio administrator.
- **`STUDIO_TOKEN` is an administrator credential.** A request carrying `Authorization: Bearer
  <STUDIO_TOKEN>` acts as the first admin. Keep it secret, and leave it empty if you do not use it.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** ("Security" tab → "Report a vulnerability")
rather than a public issue. You can expect a first answer within a week.
