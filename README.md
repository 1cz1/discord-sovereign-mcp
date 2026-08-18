<p align="center">
  <img src="https://raw.githubusercontent.com/1cz1/discord-sovereign-mcp/master/assets/banner.svg"
       width="720" alt="discord-sovereign-mcp">
</p>

<p align="center">
  Full-lifecycle Discord MCP server for any LLM — gated by a <b>Sovereignty Guard</b> that only
  mutates when the client holds the <b>#1 (highest) role</b> in the guild's role hierarchy.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/discord-sovereign-mcp?style=flat&color=5865F2" alt="npm version">
  <img src="https://img.shields.io/npm/dm/discord-sovereign-mcp?style=flat&color=5865F2" alt="npm downloads">
  <img src="https://img.shields.io/npm/l/discord-sovereign-mcp?style=flat&color=5865F2" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat" alt="node >= 20">
  <img src="https://img.shields.io/badge/tools-46-5865F2?style=flat" alt="46 tools">
  <img src="https://img.shields.io/badge/tests-80%20passing-2EA44F?style=flat" alt="80 tests passing">
  <img src="https://img.shields.io/badge/transport-stdio%20%7C%20http-5865F2?style=flat" alt="stdio | http">
</p>

---

> **Why a sovereignty guard?** Discord's permission model is hierarchical: role *position*, not
> permission flags, decides who can do what. The single most common cause of
> `Missing Permissions` failures in LLM-driven admin bots is acting from a role that *thinks* it
> has permissions but sits below the roles it tries to manage. This server refuses to act until the
> client provably sits at the top of the ladder.

## One-click install

```bash
npx discord-sovereign-mcp@latest --install
```

That's it. The installer wires the server into **Claude Code, Claude Desktop, Codex, opencode,
Cursor, Windsurf, Continue, Google Antigravity, and VS Code** — interactive picker by default,
`--all` if you want everything, backups before every write, idempotent on re-run.

- `npx discord-sovereign-mcp@latest --install --all` — every client, no prompts
- `npx discord-sovereign-mcp@latest --install --client codex,opencode --dry-run` — preview
- Full guide: [docs/INSTALL.md](./docs/INSTALL.md)

Prefer manual setup? Copy the ready-made config for your client from
[examples/mcp/](./examples/mcp) — every file, every client, the same `npx` invocation.

## What you get

- **46 tools** across control, guilds, channels, members, scaffolding, and OAuth — snake_case,
  `discord_`-prefixed, schema-strict, documented in [TOOLS.md](./TOOLS.md).
- **Sovereign Control Guard** — every destructive tool is `dry_run` by default and must pass
  `discord_assert_sovereignty` before executing with `dry_run: false`, enforced server-side.
- **One-shot server scaffolding** — `discord_scaffold_server` builds roles, categories, channels,
  and permission overwrites from a declarative template (minimal / community / gaming / support).
- **OAuth2 bootstrap** for user-token mode (`--oauth`) and **safety rails**: guild allowlist,
  audit-log reasons, idempotency checks, and `dry_run` previews that return the exact API payload.

## Quick start

```bash
# run directly (stdio)
npx discord-sovereign-mcp@latest

# run with OAuth2 user-token bootstrap
npx discord-sovereign-mcp@latest --oauth

# from source
npm install
cp .env.example .env        # then edit: DISCORD_TOKEN (or OAuth2 vars)
npm run build
npm test                    # 80 unit tests
```

### Token setup — bot (recommended for servers you own)

1. Create an application at <https://discord.com/developers/applications>.
2. Under **Bot**: create the bot, copy the token, enable **SERVER MEMBERS INTENT** and
   **MESSAGE CONTENT INTENT**.
3. Under **OAuth2 → URL Generator**: scope `bot`, permissions `Administrator`, invite the bot to
   your server. (Administrator is required for server-scoped operations; the guard still enforces
   role position.)
4. `DISCORD_TOKEN=<token>` in `.env` — `DISCORD_TOKEN_TYPE=auto` detects bot vs user.

### Token setup — user token via OAuth2

1. Create an application; under **OAuth2 → General** add a redirect
   `http://localhost:8788/callback`.
2. Set `DISCORD_OAUTH2_CLIENT_ID`, `DISCORD_OAUTH2_CLIENT_SECRET`,
   `DISCORD_OAUTH2_REDIRECT_URI` in `.env`.
3. `npx discord-sovereign-mcp@latest --oauth` — opens the authorization URL, waits for the
   callback, and writes the user token into `.env` (`DISCORD_TOKEN_TYPE=oauth2`).

### Run

```bash
npm run dev            # tsx, stdio transport
npm run start          # built dist/, stdio transport
TRANSPORT=http npm run start    # HTTP transport (POST /mcp, GET /health)
```

## The Sovereignty Guard

- `discord_assert_sovereignty` — read-only verdict: prints the full role ladder with positions and
  flags the client role. Controlled = client owns the guild (user mode) **or** holds the #1 role
  (bot mode).
- `discord_elevate_control` — moves the client role to the top of the ladder, then re-verifies.
  Never fails silently: if the API rejects the reorder, the error explains that a human must drag
  the role above the roles it couldn't outrank.
- Every destructive tool runs the same gate (`assertControl`) before its first mutating call when
  `dry_run: false` — awaited server-side, so a guard failure can never be dropped.

## Scaffolding

`discord_scaffold_server` builds a whole server from a template in one call:

```jsonc
{
  "guild_id": "1234567890",
  "template": "community",          // minimal | community | gaming | support
  "dry_run": false
}
```

It executes in safe order — roles lowest-first, then categories, then channels (with parent
wiring), then permission overwrites — guarding **once** before the first step. Each step is
isolated: on failure the tool returns `steps_total / steps_completed / steps_failed` plus the
already-created role/channel IDs so a partial scaffold can be reconciled by hand.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot or OAuth2 user token (required). |
| `DISCORD_TOKEN_TYPE` | `auto` | `auto` \| `bot` \| `oauth2` \| `user`. `auto` detects bot vs user from the token. |
| `DISCORD_ALLOWED_GUILDS` | *(empty = all)* | Comma-separated guild IDs. When set, every tool refuses guilds outside the list — even if sovereignty is held. |
| `TRANSPORT` | `stdio` | `stdio` \| `http`. |
| `HTTP_HOST` / `HTTP_PORT` | `127.0.0.1` / `3000` | HTTP transport bind address/port. |
| `DISCORD_OAUTH2_CLIENT_ID` | — | OAuth2 application client ID. |
| `DISCORD_OAUTH2_CLIENT_SECRET` | — | OAuth2 application client secret. |
| `DISCORD_OAUTH2_REDIRECT_URI` | `http://localhost:8788/callback` | Must match the redirect registered in the Discord developer portal. |
| `DISCORD_OAUTH2_PORT` | `8788` | Local callback port used by `--oauth`. |
| `AUDIT_REASON` | `via discord-sovereign-mcp` | Audit-log reason stamped on actions. |
| `LOG_LEVEL` | `info` | `info` \| `debug` \| `warn` \| `error`. |

## AI client configs

| Client | Config file | Where it goes |
| --- | --- | --- |
| Claude Code | `claude-code.json` | `.mcp.json` at the repo root (or `~/.claude.json`) |
| Claude Desktop | `claude-desktop-config.json` | menu: Claude → Settings → Developer |
| Codex CLI | `codex-config.toml` | `~/.codex/config.toml` (user) or `.codex/config.toml` (project) |
| opencode | `opencode.json` | `opencode.json` in the project (or `~/.config/opencode/`) |
| Cursor | `cursor-mcp.json` | `.cursor/mcp.json` |
| Windsurf | `windsurf-mcp.json` | `.windsurf/mcp_config.json` |
| Continue | `continue-config.json` | `~/.continue/config.json` |
| Google Antigravity | `antigravity-config.json` | Project MCP settings |

Ready-to-paste files: [examples/mcp/](./examples/mcp). Every client invokes the server the same
way: `npx discord-sovereign-mcp@latest`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run install:mcp # run the installer locally (tsx)
npm run oauth       # OAuth2 user-token bootstrap
npm run eval        # offline registry checks (add --live for protocol checks)
```

## Docs

- [TOOLS.md](./TOOLS.md) — full reference for all 46 tools (generated).
- [docs/INSTALL.md](./docs/INSTALL.md) — the installer: flags, token resolution, what gets written.
- [docs/SPEC.md](./docs/SPEC.md) — design spec: architecture, threat model, guard semantics, tool contracts.
- [docs/RECIPES.md](./docs/RECIPES.md) — end-to-end recipes for common workflows.
- [SECURITY.md](./SECURITY.md) — threat model, token handling, and reporting policy.

## License

MIT — see [LICENSE](./LICENSE).