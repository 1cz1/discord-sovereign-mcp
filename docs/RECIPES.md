# RECIPES.md

End-to-end workflows. Every destructive example uses `dry_run: false`: run without it first to
see the exact payload.

## Bootstrap a brand-new server (full lifecycle)

1. **OAuth2 (user token)**: `npm run oauth` (see README Option B), or use a bot token with the
   bot invited and holding Administrator.
2. **Create the guild:**
   ```jsonc
   discord_create_guild { "name": "My Community", "region": null }
   // -> guild_id "123...". Keep it: every later call needs it.
   ```
3. **Secure it**: set `DISCORD_ALLOWED_GUILDS=123...` in `.env` and restart, so the agent can
   only ever touch this guild.
4. **Confirm sovereignty:**
   ```jsonc
   discord_assert_sovereignty { "guild_id": "123..." }
   // NOT controlled -> discord_elevate_control { "guild_id": "123...", "dry_run": false }
   ```
5. **Scaffold the whole server in one call:**
   ```jsonc
   discord_scaffold_server { "guild_id": "123...", "template": "community", "dry_run": false }
   // -> steps_total/steps_completed/steps_failed + created role/channel IDs
   ```
6. **Add humans**: `discord_add_member_role`, `discord_invite_member` (if OAuth2), then apply the
   member workflow below.

## Member onboarding

```jsonc
discord_add_member_role { "guild_id": "123...", "user_id": "456...", "role_id": "789...", "reason": "onboarding: verified", "dry_run": false }
discord_calculate_permissions { "guild_id": "123...", "user_id": "456..." }
```

`discord_calculate_permissions` shows what the member *actually* has (owner bypass ->
Administrator -> roles -> channel overwrites) before you promise them anything.

## Moderation

```jsonc
discord_purge_messages { "guild_id": "123...", "channel_id": "987...", "amount": 50, "reason": "spam cleanup", "dry_run": false }
discord_ban_member { "guild_id": "123...", "user_id": "456...", "delete_message_days": 1, "reason": "rule 2 violation", "dry_run": false }
discord_unban_member { "guild_id": "123...", "user_id": "456...", "reason": "appeal granted", "dry_run": false }
```

## Diagnosing "Missing Permissions"

1. `discord_audit_permissions { "guild_id": "123..." }`: where does the client stand per channel?
2. `discord_calculate_permissions` for the failing member.
3. `discord_assert_sovereignty`: if the client is below #1, `discord_elevate_control` (or drag
   the role in the Discord UI; the error message explains exactly what a human must do).

## Channel surgery

```jsonc
discord_create_channel { "guild_id": "123...", "name": "support", "type": "text", "category_id": "cat-id", "dry_run": false }
discord_update_channel { "channel_id": "987...", "name": "support-archive", "dry_run": false }
discord_delete_channel { "channel_id": "987...", "dry_run": false }
```

## Role hierarchy management

```jsonc
discord_create_role { "guild_id": "123...", "name": "Moderator", "color": "#e67e22", "permissions": ["manage_messages", "kick_members", "ban_members"], "dry_run": false }
discord_reorder_roles { "guild_id": "123...", "order": ["mod-id", "helper-id", "everyone-id"], "dry_run": false }
discord_update_role { "role_id": "mod-id", "name": "Senior Moderator", "dry_run": false }
discord_delete_role { "role_id": "helper-id", "dry_run": false }
```

Role colors accept names (`blurple`, `green`, `red`, `fuchsia`, ...) or `#hex` values; unknown
colors fail with the palette list so the LLM can correct itself.

## OAuth2 user mode

```jsonc
discord_oauth_status {}                    // who am I? scopes? controlled guilds?
discord_oauth_login {}                     // opens the auth URL flow (CLI bootstrap preferred: npm run oauth)
discord_oauth_exchange { "code": "...", "redirect_uri": "http://localhost:8788/callback" }
```

User mode can act on guilds where the user is the **owner**: the strongest form of control.
The token lives in `.env` (`DISCORD_TOKEN_TYPE=oauth2`).

## Always

- Prefer `dry_run` previews over execution; they return the exact payload.
- Pass `reason` on every mutating call: it lands in the server's audit log.
- Keep `DISCORD_ALLOWED_GUILDS` pinned to exactly the guilds the agent may touch.