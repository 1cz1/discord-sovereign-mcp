# TOOLS.md

Auto-generated from the tool registry: 46 tools. Regenerate with `npx tsx scripts/gen-tools-doc.ts`.

Every tool is `discord_`-prefixed, snake_case, and schema-strict (unknown keys are rejected). Destructive tools take a `dry_run` flag (default `true`) and, when `dry_run: false`, first assert Sovereign Control (`discord_assert_sovereignty` / `discord_elevate_control`).

## add tools

### discord_add_member_role

_destructive, idempotent_  

Adds a single role to a guild member. Use when granting a role (e.g. verified, muted-by-role, member). Example: { guild_id: "123", user_id: "456", role_id: "789" }. Administrative: requires the sovereignty guard when dry_run=false.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `role_id` | string | **required** Discord snowflake ID of the role. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## assert tools

### discord_assert_sovereignty

_read-only_  

Reports whether the client can administer a guild: it owns the guild (user token) or holds the #1 (highest) role in the role hierarchy (bot token). Prints the full role ladder with positions and flags the client role. Read-only; run this first whenever an administrative action is denied.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |

## audit tools

### discord_audit_permissions

_read-only_  

Read-only. Audits how the acting client (the bot or OAuth2 user behind this MCP server) is positioned across a guild: for each channel it reports the overwrite count and whether the client holds MANAGE_CHANNELS and MANAGE_ROLES (effective permissions, including channel overwrites). Helps diagnose "Missing Permissions" failures before acting. Channels are capped at max_channels (default 50) with a truncation note. If the acting user is neither the guild owner nor a member, the audit fails with a clear message.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `max_channels` | optional number | Maximum number of channels to audit (1-100). Larger guilds are truncated with a note. |

## ban tools

### discord_ban_member

_destructive_  

Bans a member from the guild and optionally deletes their recent messages (0-7 days). Use for serious rule violations or to permanently remove a user. Example: { guild_id: "123", user_id: "456", delete_message_days: 1 }. Administrative: requires the sovereignty guard when dry_run=false.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `delete_message_days` | optional number | Number of days of the user's recent messages to delete (0-7, default 0 = keep messages). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## calculate tools

### discord_calculate_permissions

_read-only_  

Read-only. Computes the effective permission set of a member in a guild, following Discord precedence: owner bypass -> Administrator -> @everyone + role permissions -> channel @everyone/role/member overwrites. Pass channel_id to include channel overwrites. Use this before acting to predict what a member can actually do.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `channel_id` | optional string | Optional channel to include channel-level overwrites in the calculation. |

## create tools

### discord_create_guild


Creates a brand-new guild (server) with the acting user/OAuth2 token. Supports name (2-100 chars), icon (base64 data URI), a guild template code, verification level (0-4), default message notifications (0 all, 1 mentions only), explicit content filter (0-2), system channel id, initial roles (name, permission names, color, hoist, mentionable: the first role in the array configures @everyone), and initial channels (name, type, parent_id, topic: categories must be listed before their children). Example: {"name": "My New Server", "verification_level": 1, "roles": [{"name": "Mod", "permissions": ["ManageRoles"]}]}. Fails when the token is a bot (bots cannot create guilds), the name is invalid, or the account is at the 100-guild limit. No sovereignty guard applies (the guild is new).

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | string | **required** Name of the new guild (2-100 characters). |
| `icon` | optional string | Base64 data URI (data:image/png;base64,...) 1024x1024 image for the guild icon. |
| `template` | optional string | Guild template code to bootstrap from (e.g. "code" from discord.new/code). |
| `system_channel_id` | optional string | ID of the channel where welcome messages and boost events are posted. |
| `verification_level` | optional number | Verification level: 0 none, 1 low (email), 2 medium (5 min), 3 high (10 min), 4 very high (phone). |
| `default_message_notifications` | optional number | Default message notification level: 0 all messages, 1 only mentions. |
| `explicit_content_filter` | optional number | Explicit content filter: 0 disabled, 1 members without roles, 2 all members. |
| `roles` | optional array<object> | Initial roles. The first entry overrides the @everyone role. |
| `channels` | optional array<object> | Initial channels. None of the default channels are created when this is provided. |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_create_role


Creates a new role in a guild with an optional name, permission names (e.g. ["ManageRoles", "KickMembers"]), color (#hex, 0xhex, decimal, or named palette), hoist, and mentionable. Example: {"guild_id": "123456789012345678", "name": "Mod", "permissions": ["ManageRoles", "BanMembers"], "color": "#e74c3c", "dry_run": false}. Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). Fails on unknown permission names, invalid colors, or the 250-role cap. Dry-run by default.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `name` | optional string | Role name (defaults to "new role"). |
| `permissions` | optional array<string> | Discord permission names (e.g. ["ManageRoles", "KickMembers", "ViewChannel"]). Use discord_resolve_permissions for the full list. |
| `color` | optional string | Role color: #RRGGBB (e.g. #e74c3c), 0xRRGGBB, decimal integer, or a named color (red, green, blue, purple, gold, blurple, white, black, ...). |
| `hoist` | optional boolean | Show role members separately in the sidebar. |
| `mentionable` | optional boolean | Allow the role to be mentioned by anyone. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_create_channel


Creates a channel in a guild. Defaults to a text channel; pass type=voice|category|announcement|forum|stage for others. Use parent_id to nest under a category. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to actually create the channel.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `name` | string | **required** Channel name (1-100 characters; emoji allowed). |
| `type` | optional enum(text | voice | category | announcement | forum | stage) | Channel type. text (default), voice, category, announcement (news), forum, or stage. |
| `topic` | optional string | Channel topic (0-1024 characters; text, announcement, forum, media only). |
| `position` | optional number | Position in the channel list (lower = higher). |
| `parent_id` | optional string | ID of the parent category to place this channel under. |
| `nsfw` | optional boolean | Mark the channel as age-restricted (NSFW). |
| `bitrate` | optional number | Voice bitrate in bits per second (8000-384000; 96000 default, higher requires boost). |
| `user_limit` | optional number | Voice user limit (0 = unlimited, 1-99 = limit). |
| `rate_limit_per_user` | optional number | Slowmode: seconds a user must wait between messages (0-21600). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_create_thread


Creates a public or private thread in a text/announcement/forum channel. Note: for forum channels a message_id (the post starter) is required, and forum posts are created via the threads endpoint with the starter passed through. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to create.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `name` | string | **required** Thread name (1-100 characters). |
| `message_id` | optional string | Optional starter message ID. For forum channels the post starter is required: pass the starter message ID here; it is forwarded to the thread creation payload. |
| `type` | optional enum(public_thread | private_thread) | public_thread (default) or private_thread. |
| `auto_archive_duration` | optional union | Minutes of inactivity before auto-archive: 60, 1440 (1 day), 4320 (3 days), or 10080 (1 week). |
| `rate_limit_per_user` | optional number | Slowmode: seconds a user must wait between messages (0-21600). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## delete tools

### discord_delete_guild

_destructive_  

Permanently deletes a guild and ALL of its content: channels, roles, messages, emoji, and integrations. This cannot be undone. Example: {"guild_id": "123456789012345678", "dry_run": false}. Sovereignty-guarded: requires the client to own the guild (user token; bots cannot delete guilds). Dry-run by default; set dry_run=false to actually delete.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_delete_role

_destructive_  

Permanently deletes a role from a guild. Every member holding the role loses it immediately: any permissions, colors, and channel overwrites tied to the role vanish. Example: {"guild_id": "123456789012345678", "role_id": "987654321098765432", "dry_run": false}. Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). Fails when the role does not exist or is above the client in the hierarchy. Dry-run by default.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `role_id` | string | **required** Discord snowflake ID of the role. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_delete_channel

_destructive_  

Deletes a guild channel. ⚠️ WARNING: deleting a channel also deletes ALL threads inside it and permanently destroys its message history: there is no undo. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to actually delete the channel.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_delete_permission_overwrite

_destructive_  

Removes the permission overwrite for a role or member on a channel, restoring the channel to inherited (parent category + role) permissions for that target. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to actually delete the overwrite.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `target_id` | string | **required** Snowflake ID of the role or member whose overwrite should be removed. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_delete_message

_destructive_  

Deletes a single message by channel + message ID. Use for removing spam, mistakes or sensitive content. The client can only delete its own messages unless it has Manage Messages. Example: { channel_id: "123", message_id: "456" }. dry_run defaults to true; no sovereignty guard applies.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `message_id` | string | **required** Discord snowflake ID of the message. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## discord_whoami tools

### discord_whoami

_read-only_  

Reports the acting identity used by every other tool: user ID, username, global name, whether the token is a bot or a user (OAuth2) token, and the avatar hash. Use this first to understand which account will perform mutations, and why bot tokens fail on endpoints like create/delete guild. No parameters. Example: {}. Fails only if the client has not been initialized (bad DISCORD_TOKEN).

## edit tools

### discord_edit_message

_destructive_  

Edits an existing message: replace `content` (pass an EMPTY STRING to remove all text), swap the `embed`, or toggle `suppress_embeds`. NOTE: editing a message authored by another user fails with Discord error 20008: the client can only edit its own messages. Example: { channel_id: "123", message_id: "456", content: "Updated text" }. dry_run defaults to true; no sovereignty guard applies.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `message_id` | string | **required** Discord snowflake ID of the message. |
| `content` | optional string | New message content (max 2000 chars). Pass an empty string to remove all text. |
| `embed` | optional object | Replacement embed. Omit to leave embeds unchanged. |
| `suppress_embeds` | optional boolean | True to set SUPPRESS_EMBEDS on the message, false to clear it. Omit to leave flags unchanged. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## elevate tools

### discord_elevate_control

_destructive_  

Moves the client role to the top of the role hierarchy so the Sovereignty Guard permits administration. Honest and advisory: Discord only lets a role move above roles it already outranks, so this succeeds when the client role is close to the top and reports exactly what a human must do in Server Settings > Roles otherwise. Never fabricates success. Set dry_run=false to attempt the reorder.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `dry_run` | optional boolean | Preview what elevation would do without changing anything. Default true. |

## get tools

### discord_get_guild

_read-only_  

Fetches a single guild by id and returns its full object (name, owner, member count, verification level, features, etc.) plus the permission bitfield when present. Example: {"guild_id": "123456789012345678"}. Fails when the guild does not exist, was deleted, or the client lacks access (check DISCORD_ALLOWED_GUILDS).

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |

### discord_get_role

_read-only_  

Fetches a single role by id within a guild: name, position, color hex, hoist/mentionable/managed flags, permission names, and the raw permission bitfield as a decimal string. Example: {"guild_id": "123456789012345678", "role_id": "987654321098765432"}. Fails when the role or guild does not exist.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `role_id` | string | **required** Discord snowflake ID of the role. |

### discord_get_channel

_read-only_  

Fetches a single channel by ID (text, voice, category, thread, forum, ...) and returns its full details including topic, position, parent category, overwrites, and type-specific fields.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |

### discord_get_member

_read-only_  

Fetches a single guild member by user ID, including nickname, full role list, join date, boost status and timeout. Use before updating a member to see their current state. Example: { guild_id: "123", user_id: "456" }.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |

### discord_get_ban

_read-only_  

Fetches the ban record for a single user in a guild, including the ban reason. Use to check why someone was banned or whether they are banned at all. Example: { guild_id: "123", user_id: "456" }.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |

### discord_get_message

_read-only_  

Fetches a single message by channel + message ID with full content, author, embeds summary, attachments count, pin state and reply target. Use before editing or deleting a message to verify its state. Example: { channel_id: "123", message_id: "456" }.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `message_id` | string | **required** Discord snowflake ID of the message. |

## kick tools

### discord_kick_member

_destructive_  

Removes a member from the guild. WARNING: the member can rejoin via any invite: use discord_ban_member to prevent re-entry. Example: { guild_id: "123", user_id: "456" }. Administrative: requires the sovereignty guard when dry_run=false.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## list tools

### discord_list_guilds

_read-only_  

Lists the guilds (servers) the acting token can see, paginated. Each entry includes the guild id, name, icon hash, whether the client owns it, and the resolved permission names. Example: {"limit": 20, "offset": 0}. Use the returned next_offset for the next page. Fails on invalid token or when the client has no guilds.

| Parameter | Type | Description |
| --- | --- | --- |
| `limit` | optional number | Number of results to return (1-100). |
| `offset` | optional number | Pagination offset (use the previous response's next_offset). |

### discord_list_roles

_read-only_  

Lists every role in a guild, ordered highest->lowest position (as returned by the API), paginated. Each entry shows the role id, name, position, color hex, hoist/mentionable/managed flags, and resolved permission names. Example: {"guild_id": "123456789012345678", "limit": 50}. Fails when the guild does not exist or the client cannot see it.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `limit` | optional number | Number of results to return (1-100). |
| `offset` | optional number | Pagination offset (use the previous response's next_offset). |

### discord_list_channels

_read-only_  

Lists all channels in a guild, optionally filtered by parent category, and optionally including active threads. Channels are grouped by their parent category in the text output; categories show their child count. Use parent_id to inspect a single category. Paginate with limit/offset (next_offset is returned when more pages exist).

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `parent_id` | optional string | Only return channels whose parent is this category (or, for threads, whose parent is this channel). |
| `include_threads` | optional boolean | Also list currently active threads (from GET /guilds/{guild.id}/threads/active), marked separately. |
| `limit` | optional number | Number of results to return (1-100). |
| `offset` | optional number | Pagination offset (use the previous response's next_offset). |

### discord_list_members

_read-only_  

Lists members of a guild, newest members first. Use when you need an overview of who is in a server, member counts, or to find a member ID. Example: { guild_id: "123", limit: 100 }. Pass the previous response's next_after as `after` to page through large servers.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `limit` | optional number | Number of members to return (1-1000). |
| `after` | optional string | Snowflake ID cursor: return results after this ID (higher-ID = newer). |

### discord_list_bans

_read-only_  

Lists all banned users in a guild with ban reasons. Use to audit the ban list or confirm a user is banned before unbanning. Example: { guild_id: "123", limit: 50 }.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `limit` | optional number | Number of results to return (1-100). |
| `offset` | optional number | Pagination offset (use the previous response's next_offset). |

### discord_list_messages

_read-only_  

Lists recent messages in a channel, newest first by default. Use `before` to page older, `after` to page newer, or `around` to center on one message. WARNING: `before`/`after`/`around` are mutually exclusive, and `around` with limit above 100 is invalid. Example: { channel_id: "123", limit: 50, before: "999999999999999999" }.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `limit` | optional number | Number of messages to return (1-100). |
| `before` | optional string | Snowflake ID cursor: return results before this ID. |
| `after` | optional string | Snowflake ID cursor: return results after this ID (higher-ID = newer). |
| `around` | optional string | Snowflake ID cursor: return messages around this ID (centered window). |

## oauth tools

### discord_oauth_status

_read-only_  

Reports the OAuth2 bootstrap state: transport, current token type, whether the Discord application credentials (DISCORD_OAUTH2_CLIENT_ID / SECRET / REDIRECT_URI) are configured, and the required scopes. Read-only. Run this before discord_oauth_login.

### discord_oauth_login


Builds the Discord authorization URL for the user OAuth2 flow (scopes: identify, guilds, guilds.join, guilds.members.read). The user opens the URL, approves, and either the browser hits the local /callback route (TRANSPORT=http) or the user pastes the resulting code into discord_oauth_exchange (TRANSPORT=stdio).

### discord_oauth_exchange


Exchanges an authorization code for a user access token, optionally persists it to .env, and verifies it against https://discord.com/api/v10/oauth2/@me. After persisting, restart the server so it authenticates with the user token (user-scope operations like discord_create_guild become available).

| Parameter | Type | Description |
| --- | --- | --- |
| `code` | string | **required** The authorization code from the redirect URL (?code=...) after the user approves. |
| `persist` | optional boolean | Write the exchanged token into .env (DISCORD_TOKEN, DISCORD_TOKEN_TYPE=oauth2). Default true. |

## purge tools

### discord_purge_messages

_destructive_  

Bulk-deletes messages in a channel. Fetches up to 100 messages (newer than `after` if given), skips messages older than 14 days (the bulk-delete window) and pinned messages unless `include_pinned`, then deletes them in one bulk call. `limit` caps how many are deleted. Example: { channel_id: "123", limit: 50, after: "999999999999999999" }. Administrative: requires the sovereignty guard when dry_run=false.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `limit` | optional number | Maximum number of messages to purge (1-100). |
| `after` | optional string | Snowflake ID cursor: return results after this ID (higher-ID = newer). |
| `include_pinned` | optional boolean | True to also delete pinned messages (they are skipped by default). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## remove tools

### discord_remove_member_role

_destructive, idempotent_  

Removes a single role from a guild member. Use when revoking a role (e.g. removing a muted-by-role, stripping an elevated permission). Example: { guild_id: "123", user_id: "456", role_id: "789" }. Administrative: requires the sovereignty guard when dry_run=false.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `role_id` | string | **required** Discord snowflake ID of the role. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## reorder tools

### discord_reorder_roles


Reorders roles in a guild by assigning each listed role a new position. IMPORTANT: only roles BELOW the acting identity's highest role can be moved (Discord hierarchy rules), and positions are applied sequentially in array order. The @everyone role always sits at position 0. Example: {"guild_id": "123456789012345678", "positions": [{"role_id": "111111111111111111", "position": 2}, {"role_id": "222222222222222222", "position": 1}]}. Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). Fails when a role is above the client or does not exist. Dry-run by default.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `positions` | array<object> | **required** Roles and their new positions, applied sequentially in array order. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## resolve tools

### discord_resolve_permissions

_read-only_  

Read-only permission resolver. Given permission names -> returns the combined bitfield (decimal string). Given a bitfield (decimal or 0x hex) -> returns the resolved permission names. Given neither -> returns the full catalog of every valid permission name with its bit value. Examples: {"permissions": ["ManageRoles", "KickMembers"]} -> bitfield; {"bitfield": "8"} -> ["KickMembers"]; {} -> catalog. Fails on unknown permission names (the error lists every valid name) or a malformed bitfield.

| Parameter | Type | Description |
| --- | --- | --- |
| `permissions` | optional array<string> | Discord permission names (e.g. ["ManageRoles", "KickMembers", "ViewChannel"]). Use discord_resolve_permissions for the full list. |
| `bitfield` | optional string | Permission bitfield as a decimal string (e.g. "104324681") or 0x hex (e.g. "0x637a41"). |

## scaffold tools

### discord_scaffold_server

_destructive_  

Builds a full server structure from a canonical template in one call: role ladder (Member lowest -> Moderator -> Administrator top), categories, channels (text, voice, announcement, forum) and permission overwrites. Roles are created lowest-first so each new role lands above the previous one. Sovereign control is asserted once before the first step; every step is executed individually and partial failures are reported honestly. Templates: minimal, community (default), gaming, support. Set dry_run=false to apply.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `template` | optional enum(minimal | community | gaming | support) | Server layout blueprint. Defaults to community. |
| `dry_run` | optional boolean | Preview the plan without changing anything. Default true. |
| `reason` | optional string | Audit-log reason shown to Discord. |

## search tools

### discord_search_members

_read-only_  

Searches guild members by username or nickname (1-32 characters, case-insensitive). Use when you need to find a specific member without paging through the whole member list. Example: { guild_id: "123", query: "alice", limit: 25 }.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `query` | string | **required** Search query: username or nickname fragment (1-32 chars). |
| `limit` | optional number | Number of matching members to return (1-1000). |

## send tools

### discord_send_message

_destructive_  

Sends a message to a channel: plain text content, a rich embed, or both. At least one of `content` or `embed` is required. Use for announcements, replies, or structured notifications. Example: { channel_id: "123", content: "Hello!", embed: { title: "Deploy", description: "Done", color: "#2ecc71" } }. dry_run defaults to true; no sovereignty guard applies: messaging is not an administrative action.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `content` | optional string | Plain-text message content (max 2000 chars). |
| `embed` | optional object | Rich embed to attach. See field descriptions for limits. |
| `suppress_embeds` | optional boolean | True to suppress link previews/embeds on this message (SUPPRESS_EMBEDS flag). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## set tools

### discord_set_permission_overwrite


Creates or replaces the permission overwrite for a role or member on a channel. Overwrites follow Discord precedence: @everyone -> role -> member. Provide permission names in allow and/or deny (e.g. ManageRoles, ViewChannel, SendMessages). The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to apply.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `target_type` | enum(role | member) | **required** Whether the overwrite targets a role (0) or a member (1). |
| `target_id` | string | **required** Snowflake ID of the role or member the overwrite applies to. |
| `allow` | optional array<string> | Permissions to explicitly ALLOW for this target (e.g. ["ViewChannel", "SendMessages"]). |
| `deny` | optional array<string> | Permissions to explicitly DENY for this target (e.g. ["SendMessages"]). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## unban tools

### discord_unban_member

_destructive_  

Removes a ban for a user, allowing them to rejoin via invite. Use to restore access after a mistaken or expired ban. Example: { guild_id: "123", user_id: "456" }. Administrative: requires the sovereignty guard when dry_run=false.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

## update tools

### discord_update_guild


Modifies an existing guild: name, description, verification level (0-4), default message notifications (0-1), explicit content filter (0-2), system channel, afk channel, afk timeout (60-43200s), icon, or banner (base64 data URIs). Example: {"guild_id": "123456789012345678", "name": "New Name", "description": "We do things here"}. Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token), otherwise discord_assert_control is suggested. Dry-run by default; set dry_run=false to apply.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `name` | optional string |  |
| `description` | optional string | Guild description (shown in server browsing and invites). |
| `verification_level` | optional number |  |
| `default_message_notifications` | optional number |  |
| `explicit_content_filter` | optional number |  |
| `system_channel_id` | optional string |  |
| `afk_channel_id` | optional string |  |
| `afk_timeout` | optional number | AFK timeout in seconds (valid: 60, 300, 900, 1800, 3600). |
| `icon` | optional string | Base64 data URI for the guild icon (null removes it). |
| `banner` | optional string | Base64 data URI for the guild banner (requires BANNER feature). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_update_role


Modifies an existing role: name, permissions, color, hoist, mentionable, icon (data URI), or unicode_emoji. IMPORTANT: when permissions is provided it REPLACES the role's entire permission set: omit it to leave permissions untouched. Example: {"guild_id": "123456789012345678", "role_id": "987654321098765432", "name": "Senior Mod", "color": "#f1c40f", "dry_run": false}. Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). Fails on unknown permission names, invalid colors, or roles above the client in the hierarchy. Dry-run by default.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `role_id` | string | **required** Discord snowflake ID of the role. |
| `name` | optional string |  |
| `permissions` | optional array<string> | Discord permission names (e.g. ["ManageRoles", "KickMembers", "ViewChannel"]). Use discord_resolve_permissions for the full list. |
| `color` | optional string | Role color: #RRGGBB (e.g. #e74c3c), 0xRRGGBB, decimal integer, or a named color (red, green, blue, purple, gold, blurple, white, black, ...). |
| `hoist` | optional boolean |  |
| `mentionable` | optional boolean |  |
| `icon` | optional string | Base64 data URI for the role icon (requires ROLE_ICONS feature). |
| `unicode_emoji` | optional string | Standard unicode emoji for the role icon. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_update_channel


Updates one or more properties of a guild channel (name, topic, position, parent category, nsfw, bitrate, user limit, slowmode). Pass topic: "" to clear the topic. Only the fields you provide are changed. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to apply.

| Parameter | Type | Description |
| --- | --- | --- |
| `channel_id` | string | **required** Discord snowflake ID of the channel. |
| `name` | optional string | New channel name (1-100 characters). |
| `topic` | optional string | New topic. Pass an empty string ("") to clear the topic. |
| `position` | optional number | New position in the channel list (lower = higher). |
| `parent_id` | optional string | ID of the new parent category (move the channel). |
| `nsfw` | optional boolean | Mark/unmark the channel as age-restricted (NSFW). |
| `bitrate` | optional number | New voice bitrate in bits per second. |
| `user_limit` | optional number | New voice user limit (0 = unlimited). |
| `rate_limit_per_user` | optional number | New slowmode in seconds (0 = off). |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |

### discord_update_member

_destructive, idempotent_  

Updates a guild member: nickname, roles and/or timeout. WARNING: `roles` REPLACES the member's ENTIRE role set: pass every role ID the member should have, or omit `roles` to leave roles untouched. `nick` may be an empty string to clear the nickname. `timeout_minutes` is 1-40320 (28 days max); 0 removes an active timeout. Cannot mute or deafen the member in voice: that requires a gateway connection, not this endpoint. Administrative: requires the sovereignty guard when dry_run=false. Example: { guild_id: "123", user_id: "456", nick: "new name", timeout_minutes: 30 }.

| Parameter | Type | Description |
| --- | --- | --- |
| `guild_id` | string | **required** Discord snowflake ID of the guild (right-click the server icon > Copy Server ID). |
| `user_id` | string | **required** Discord snowflake ID of the user. |
| `nick` | optional string | New nickname (max 32 chars). Pass an empty string to clear the nickname. |
| `roles` | optional array<string> | FULL replacement role set for the member (max 250 role IDs). Omitting this leaves roles unchanged. |
| `timeout_minutes` | optional number | Timeout duration in minutes (1-40320, i.e. up to 28 days). Sent to Discord as communication_disabled_until = now + minutes. Set 0 to remove an active timeout. |
| `reason` | optional string | Audit-log reason stamped on the action (appears in the server audit log). |
| `dry_run` | optional boolean | When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation. |
