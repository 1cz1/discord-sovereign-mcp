# MCP client configs

Ready-to-paste configs for connecting an AI client to `discord-sovereign-mcp`.
The server is invoked as `npx discord-sovereign-mcp@latest` (stdio transport); see
[../http/http-client-config.json](../http/http-client-config.json) for the HTTP transport variant.

> **Easier than copy-paste:** `npx discord-sovereign-mcp@latest --install` configures every client
> below (and Claude Desktop, VS Code too) for you — see [docs/INSTALL.md](../../docs/INSTALL.md).

| File | Client | Where it goes |
| --- | --- | --- |
| `claude-code.json` | Claude Code | project scope: `.mcp.json` at the repo root |
| `claude-desktop-config.json` | Claude Desktop | `claude_desktop_config.json` (menu: Claude → Settings → Developer) |
| `codex-config.toml` | Codex CLI | `~/.codex/config.toml` (user) or `.codex/config.toml` (project) |
| `opencode.json` | opencode | `opencode.json` in the project (or `~/.config/opencode/`) |
| `antigravity-config.json` | Google Antigravity | Project MCP settings |
| `cursor-mcp.json` | Cursor | `.cursor/mcp.json` |
| `windsurf-mcp.json` | Windsurf | `.windsurf/mcp_config.json` |
| `continue-config.json` | Continue | `~/.continue/config.json` |

## Setup

1. Get a token — either a bot token ([discord.com/developers/applications](https://discord.com/developers/applications))
   or a user token via OAuth2 (`npx discord-sovereign-mcp --oauth`).
2. Replace `DISCORD_TOKEN` in the config with your token.
3. **Strongly recommended**: set `DISCORD_ALLOWED_GUILDS` to the comma-separated IDs of the
   servers the agent may touch. When set, every tool refuses guilds outside the list — even when
   the sovereignty guard would otherwise pass.

## OAuth2 (user-token mode)

If you would rather run the OAuth2 flow (browser authorization, token persisted to `.env`),
leave `DISCORD_TOKEN` empty in the config and run the server locally first:

```bash
npx discord-sovereign-mcp --oauth
```

Then point the client at the same `.env` via the config env block, or use `TRANSPORT=http` and
connect to `http://127.0.0.1:3000/mcp`.

## Security notes

- Never commit a config with a real token.
- Keep `TRANSPORT=stdio` unless you need HTTP; the HTTP binding defaults to loopback
  (`HTTP_HOST=127.0.0.1`).
- The Sovereignty Guard only allows mutating tools when the client holds the #1 role (bot token)
  or owns the guild (user token) — verify with `discord_assert_sovereignty` first.