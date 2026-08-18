# Installing discord-sovereign-mcp

The server runs from `npx`: no install step, no build step, nothing to keep updated.

## The one-liner

Run this in the terminal (any directory is fine: it scans both project and user configs):

```bash
npx discord-sovereign-mcp@latest --install
```

You get an interactive picker:

```
? Which clients should I configure? (space to toggle, enter to confirm)
  [ ] Claude Code          (.mcp.json + ~/.claude.json)
  [ ] Claude Desktop       (claude_desktop_config.json)
  [ ] Codex                (.codex/config.toml + ~/.codex/config.toml)
  [ ] opencode             (opencode.json)
  [ ] Cursor               (.cursor/mcp.json + ~/.cursor/mcp.json)
  [ ] Windsurf             (.windsurf/mcp_config.json)
  [ ] Continue             (~/.continue/config.json)
  [ ] Google Antigravity   (.antigravity/mcp.json)
  [ ] VS Code              (.vscode/mcp.json)
```

After choosing, it asks for a token (see below), writes every selected config, and prints a
summary. Existing config files are backed up as `<file>.<timestamp>.bak` before any write.

## Flags

| Flag | Meaning |
| --- | --- |
| `--all` / `-a` | Skip the picker and write **all** clients. |
| `--client <id>,<id>` | Only configure the given clients (`claude-code`, `claude-desktop`, `codex`, `opencode`, `cursor`, `windsurf`, `continue`, `antigravity`, `vscode`). |
| `--token <token>` | Supply the token non-interactively. |
| `--project` | Only project-scoped configs (files inside the current repo). |
| `--dry-run` | Print what would be written, change nothing. |
| `--no-prompt` | Never ask; in non-TTY environments this is automatic. |
| `-h` / `--help` | Help. |

Re-running the installer is safe: existing entries are merged (JSON) or detected (TOML), so
nothing is duplicated or clobbered.

## Where the token comes from

The installer resolves the token in this order:

1. `--token` flag
2. `DISCORD_TOKEN` environment variable
3. `DISCORD_TOKEN` in the project's `.env` file
4. Interactive paste (if a TTY is available)
5. The placeholder `your-bot-or-oauth2-token` (config still works once you fill it in)

A token you paste is written to `.env` as `DISCORD_TOKEN=...`; add
`DISCORD_TOKEN_TYPE=auto` is not needed: auto-detection handles bot and user tokens.

## What gets written

Every client receives the same server definition under the key `discord-sovereign`:

```json
{
  "mcpServers": {
    "discord-sovereign": {
      "command": "npx",
      "args": ["discord-sovereign-mcp@latest"],
      "env": {
        "DISCORD_TOKEN": "...",
        "DISCORD_TOKEN_TYPE": "auto",
        "DISCORD_ALLOWED_GUILDS": "",
        "TRANSPORT": "stdio",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

opencode uses its native schema instead (`type: local`, `command: [...]`, `environment: {...}`).
Codex's TOML gets a `[mcp_servers.discord-sovereign]` block.

## Manual setup

Prefer doing it by hand, or use the server in a way the installer doesn't cover? Copy the
ready-made config for your client from [`examples/mcp/`](../examples/mcp/) and replace
`DISCORD_TOKEN`. See [`examples/mcp/README.md`](../examples/mcp/README.md) for where each file goes.

## Getting a token

- **Bot token**: create an application at [discord.com/developers/applications](https://discord.com/developers/applications),
  add a bot, copy the token. Bot tokens cannot create/delete guilds.
- **User token (OAuth2)**: run `npx discord-sovereign-mcp --oauth`, authorize in the browser,
  and the token is persisted to `.env` automatically. User tokens can do everything, including
  server creation.

## After installing

1. Restart your AI client.
2. Ask it to run `discord_whoami`: it reports which account is acting and whether it is bot or
   user mode.
3. Optionally restrict blast radius: set `DISCORD_ALLOWED_GUILDS` to the comma-separated IDs of
   the servers the agent may touch. Every tool then refuses guilds outside the list.