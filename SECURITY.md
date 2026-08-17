# Security Policy

## Threat model

discord-sovereign-mcp is a **full-privilege administrative agent** for Discord. It can create,
delete, and modify servers, roles, channels, members, and messages. It must therefore be treated
like an administrator account:

- Anyone who can call these tools can perform destructive, irreversible actions on every guild the
  token can reach.
- The server binds the HTTP transport to `127.0.0.1` by default for a reason — do not expose it to
  untrusted networks.
- MCP clients (LLM chat apps) decide when to call tools. A prompt-injected instruction from a
  message the bot reads could ask it to delete a channel — the layered defenses below are the only
  thing between that instruction and a `DELETE`.

## Layered defenses

### 1. Sovereign Control Guard (primary)

Every destructive tool defaults to `dry_run: true` and returns the exact API payload it *would*
send. Execution with `dry_run: false` first calls `assertControl(guildId)`, which refuses to run
unless the client **owns the guild** (user token) or **holds the #1 role** (bot token). Role
*position*, not permission flags, is what decides hierarchy on Discord — this is the single most
effective protection against "I think I can, so I did" failures.

### 2. Guild allowlist

Set `DISCORD_ALLOWED_GUILDS` to a comma-separated list of guild IDs. When set, every tool refuses
(without contacting Discord) any guild outside the list. This bounds blast radius even if the
token is compromised.

### 3. `dry_run` previews

All destructive tools accept `dry_run` (default `true`). Previews return the exact request payload,
so an LLM (and a human reviewing its logs) can see precisely what would be sent.

### 4. Idempotency and reconciliation

Creating tools check for existing resources before acting (no duplicate roles/channels). The
scaffolder reports `steps_completed` / `steps_failed` and the IDs of everything it created, so a
partial failure is recoverable instead of silently partial.

### 5. Token hygiene

- `DISCORD_TOKEN` and OAuth2 secrets live only in `.env` (git-ignored). Never commit them.
- The OAuth2 bootstrap writes the user token into `.env` with `DISCORD_TOKEN_TYPE=oauth2`; the file
  is rewritten line-by-line, preserving all other settings.
- Tokens are sent only to `discord.com/api/v10` endpoints over HTTPS.
- The token is never echoed in tool output: `discord_oauth_status` reports the application/author
  and scopes, not the credential.

### 6. Fail-closed, explicit errors

- Unknown config values throw `ConfigError` at startup rather than guessing.
- Unknown zod keys are rejected (all schemas are strict).
- Discord API errors are translated to actionable messages (e.g. the role-position explanation in
  `elevateControl`) instead of raw stack traces.
- The client verifies identity at startup and refuses to serve when authentication fails.

## Reporting a vulnerability

Do **not** open a public issue for security bugs. Report privately to the maintainers by opening a
GitHub security advisory (if this repository is public) or by emailing the address listed in the
repository profile. Include:

- the affected version and how the server was deployed (transport, token type),
- a minimal reproduction (tool name + inputs),
- the impact you believe it has.

## What is *not* a vulnerability

- A prompt-injected message tricking the LLM into calling a tool — this is inherent to
  tool-using agents; the defenses above (allowlist, guard, dry-run) are the mitigation.
- Discord permission failures (e.g. `Missing Permissions`) — these are Discord's own enforcement
  and are surfaced as actionable diagnostics, not bugs.
- Rate-limit responses from the Discord API.

## Hardening checklist

- [ ] `DISCORD_ALLOWED_GUILDS` set to exactly the guilds the agent may touch.
- [ ] Bot token created with the minimum intents required; `Administrator` permission scoped to the
      deployment guild only.
- [ ] HTTP transport bound to `127.0.0.1`; never deployed behind a public reverse proxy without
      auth (the MCP endpoint has no authentication).
- [ ] `.env` never committed; credentials rotated immediately after any leak.
- [ ] Audit logs reviewed (`AUDIT_REASON` stamps every action).