import { z } from 'zod';
import { ChannelType, PermissionFlagsBits } from 'discord-api-types/v10';
import type { APIGuild, APIRole } from 'discord-api-types/payloads/v10';
import type {
  RESTPatchAPIGuildJSONBody,
  RESTPatchAPIGuildRoleJSONBody,
  RESTPostAPIGuildRoleJSONBody,
  RESTPostAPIGuildsJSONBody,
} from 'discord-api-types/rest/v10';
import type { MCPResult, RegisteredTool, ToolContext, ToolInput } from './registry.js';
import { fail, ok } from './registry.js';
import {
  colorSchema,
  dryRunSchema,
  guildIdSchema,
  limitSchema,
  offsetSchema,
  permissionsSchema,
  reasonSchema,
  roleIdSchema,
} from './sharedSchemas.js';
import {
  ALL_PERMISSION_NAMES,
  bitsToPermissionNames,
  parseBitfield,
  parseColor,
  permissionNamesToBits,
} from '../services/permissionService.js';
import { fmtGuild, fmtPermissions, fmtRole, paginate, resolveReason } from '../utils/format.js';

const PERMISSION_BITS = PermissionFlagsBits as Record<string, bigint>;

async function guard(guildId: string, ctx: ToolContext): Promise<void> {
  await ctx.control.assertControl(guildId);
}

// ── discord_whoami ────────────────────────────────────────────────────────────

const whoamiTool: RegisteredTool = {
  name: 'discord_whoami',
  title: 'Who Am I',
  description:
    'Reports the acting identity used by every other tool: user ID, username, global name, whether the token is a bot or a user (OAuth2) token, and the avatar hash. ' +
    'Use this first to understand which account will perform mutations, and why bot tokens fail on endpoints like create/delete guild. ' +
    'No parameters. Example: {}. Fails only if the client has not been initialized (bad DISCORD_TOKEN).',
  inputSchema: z.object({}).strict(),
  annotations: { readOnlyHint: true },
  handle: async (_params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const me = ctx.client.me;
    const text = [
      `**Who am I?**`,
      `- ID: \`${me.id}\``,
      `- Username: @${me.username}`,
      `- Global name: ${me.globalName ?? '(none)'}`,
      `- Bot: ${me.bot ? 'yes' : 'no'}`,
      `- Token kind: ${ctx.client.tokenKind} (${ctx.client.isBot ? 'bot tokens cannot create or delete guilds' : 'user/OAuth2: full guild ownership powers'})`,
      `- Avatar: ${me.avatar ? `\`${me.avatar}\`` : '(none)'}`,
    ].join('\n');
    return ok(text, {
      id: me.id,
      username: me.username,
      global_name: me.globalName,
      bot: me.bot,
      avatar: me.avatar,
      is_bot: ctx.client.isBot,
      is_user: ctx.client.isUser,
      token_kind: ctx.client.tokenKind,
    });
  },
};

// ── discord_list_guilds ───────────────────────────────────────────────────────

const listGuildsTool: RegisteredTool = {
  name: 'discord_list_guilds',
  title: 'List Guilds',
  description:
    'Lists the guilds (servers) the acting token can see, paginated. Each entry includes the guild id, name, icon hash, whether the client owns it, and the resolved permission names. ' +
    'Example: {"limit": 20, "offset": 0}. Use the returned next_offset for the next page. Fails on invalid token or when the client has no guilds.',
  inputSchema: z
    .object({
      limit: limitSchema,
      offset: offsetSchema,
    })
    .strict(),
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const limit = (params.limit as number | undefined) ?? 20;
    const offset = (params.offset as number | undefined) ?? 0;
    const guilds = await ctx.client.getGuilds();
    const page = paginate(guilds, { limit, offset });
    const items = page.items.map((g: APIGuild) => ({
      id: g.id,
      name: g.name,
      icon: g.icon ?? null,
      owner: g.owner ?? null,
      permissions: g.permissions ? bitsToPermissionNames(BigInt(g.permissions)) : [],
    }));
    const lines = items.map(
      (g, i) =>
        `${offset + i + 1}. **${g.name}** \`${g.id}\`: ${g.owner ? 'owner' : 'member'} · perms: ${fmtPermissions(g.permissions)}`
    );
    const header = `**Guilds** (${page.page.total ?? guilds.length} total, showing ${offset + 1}-${offset + page.page.count})`;
    const next = page.page.has_more ? `\nNext page: set offset=${page.page.next_offset}.` : '';
    return ok(`${[header, ...lines].join('\n')}${next}`, { guilds: items, page: page.page });
  },
};

// ── discord_get_guild ─────────────────────────────────────────────────────────

const getGuildTool: RegisteredTool = {
  name: 'discord_get_guild',
  title: 'Get Guild',
  description:
    'Fetches a single guild by id and returns its full object (name, owner, member count, verification level, features, etc.) plus the permission bitfield when present. ' +
    'Example: {"guild_id": "123456789012345678"}. Fails when the guild does not exist, was deleted, or the client lacks access (check DISCORD_ALLOWED_GUILDS).',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
    })
    .strict(),
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const guild = await ctx.client.getGuild(guildId);
    const structured: Record<string, unknown> = { guild: { ...guild } };
    if (typeof guild.permissions === 'string') {
      const g = structured.guild as Record<string, unknown>;
      g.permissions_bitfield = guild.permissions;
      g.permissions_names = bitsToPermissionNames(BigInt(guild.permissions));
    }
    return ok(`**Guild**\n${fmtGuild(guild)}`, structured);
  },
};

// ── discord_create_guild ──────────────────────────────────────────────────────

interface CreateRoleInput {
  name?: string;
  permissions?: string[];
  color?: string;
  hoist?: boolean;
  mentionable?: boolean;
}

interface CreateChannelInput {
  name: string;
  type?: number;
  parent_id?: string;
  topic?: string;
}

function buildCreateRoleBody(role: CreateRoleInput): RESTPostAPIGuildRoleJSONBody {
  const body: RESTPostAPIGuildRoleJSONBody = {};
  if (role.name !== undefined) body.name = role.name;
  if (role.permissions !== undefined && role.permissions.length > 0) {
    body.permissions = permissionNamesToBits(role.permissions).toString();
  }
  if (role.color !== undefined) body.color = parseColor(role.color);
  if (role.hoist !== undefined) body.hoist = role.hoist;
  if (role.mentionable !== undefined) body.mentionable = role.mentionable;
  return body;
}

const createGuildTool: RegisteredTool = {
  name: 'discord_create_guild',
  title: 'Create Guild',
  description:
    'Creates a brand-new guild (server) with the acting user/OAuth2 token. Supports name (2-100 chars), icon (base64 data URI), a guild template code, verification level (0-4), ' +
    'default message notifications (0 all, 1 mentions only), explicit content filter (0-2), system channel id, initial roles (name, permission names, color, hoist, mentionable: ' +
    'the first role in the array configures @everyone), and initial channels (name, type, parent_id, topic: categories must be listed before their children). ' +
    'Example: {"name": "My New Server", "verification_level": 1, "roles": [{"name": "Mod", "permissions": ["ManageRoles"]}]}. ' +
    'Fails when the token is a bot (bots cannot create guilds), the name is invalid, or the account is at the 100-guild limit. No sovereignty guard applies (the guild is new).',
  inputSchema: z
    .object({
      name: z
        .string()
        .min(2)
        .max(100)
        .describe('Name of the new guild (2-100 characters).'),
      icon: z
        .string()
        .optional()
        .describe('Base64 data URI (data:image/png;base64,...) 1024x1024 image for the guild icon.'),
      template: z
        .string()
        .optional()
        .describe('Guild template code to bootstrap from (e.g. "code" from discord.new/code).'),
      system_channel_id: guildIdSchema.describe('ID of the channel where welcome messages and boost events are posted.').optional(),
      verification_level: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe('Verification level: 0 none, 1 low (email), 2 medium (5 min), 3 high (10 min), 4 very high (phone).'),
      default_message_notifications: z
        .number()
        .int()
        .min(0)
        .max(1)
        .optional()
        .describe('Default message notification level: 0 all messages, 1 only mentions.'),
      explicit_content_filter: z
        .number()
        .int()
        .min(0)
        .max(2)
        .optional()
        .describe('Explicit content filter: 0 disabled, 1 members without roles, 2 all members.'),
      roles: z
        .array(
          z
            .object({
              name: z.string().min(1).max(100).optional(),
              permissions: permissionsSchema,
              color: colorSchema,
              hoist: z.boolean().optional().describe('Show role members separately in the sidebar.'),
              mentionable: z.boolean().optional().describe('Allow the role to be mentioned by anyone.'),
            })
            .strict()
        )
        .optional()
        .describe('Initial roles. The first entry overrides the @everyone role.'),
      channels: z
        .array(
          z
            .object({
              name: z.string().min(1).max(100).describe('Channel name.'),
              type: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe('Channel type: 0 text, 2 voice, 4 category, 5 announcement, 13 stage, 15 forum, 16 media.'),
              parent_id: z.string().min(1).max(32).optional().describe('Parent category id (categories must be listed first).'),
              topic: z.string().max(1024).optional().describe('Channel topic (text-like channels).'),
            })
            .strict()
        )
        .optional()
        .describe('Initial channels. None of the default channels are created when this is provided.'),
      dry_run: dryRunSchema,
    })
    .strict(),
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    if (ctx.client.isBot) {
      return fail(
        'Bot tokens cannot create guilds (only user/OAuth2 tokens can). Complete the OAuth2 bootstrap (`npm run oauth`) or set DISCORD_TOKEN to a user token.'
      );
    }
    const dryRun = (params.dry_run as boolean | undefined) ?? true;

    let body: RESTPostAPIGuildsJSONBody;
    try {
      const payload: Record<string, unknown> = { name: params.name as string };
      if (params.icon !== undefined) payload.icon = params.icon;
      if (params.template !== undefined) payload.template = params.template;
      if (params.system_channel_id !== undefined) payload.system_channel_id = params.system_channel_id;
      if (params.verification_level !== undefined) payload.verification_level = params.verification_level;
      if (params.default_message_notifications !== undefined) payload.default_message_notifications = params.default_message_notifications;
      if (params.explicit_content_filter !== undefined) payload.explicit_content_filter = params.explicit_content_filter;
      if (params.roles !== undefined) {
        payload.roles = (params.roles as CreateRoleInput[]).map(buildCreateRoleBody);
      }
      if (params.channels !== undefined) {
        payload.channels = (params.channels as CreateChannelInput[]).map((ch) => {
          const out: Record<string, unknown> = { name: ch.name };
          if (ch.type !== undefined) out.type = ch.type as ChannelType;
          if (ch.parent_id !== undefined) out.parent_id = ch.parent_id;
          if (ch.topic !== undefined) out.topic = ch.topic;
          return out;
        });
      }
      body = payload as unknown as RESTPostAPIGuildsJSONBody;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    if (dryRun) {
      const text = [
        `🔍 Dry run: no guild created. The following guild would be created:`,
        `- Name: **${body.name}**`,
        `- Verification level: ${body.verification_level ?? 0}`,
        `- Roles: ${body.roles?.length ?? 0} (first entry configures @everyone)`,
        `- Channels: ${body.channels?.length ?? 0} (default channels omitted when provided)`,
        `Set dry_run=false to actually create it.`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: body });
    }

    const guild = await ctx.client.createGuild(body);
    const text = [
      `✅ Guild created: **${guild.name}** \`${guild.id}\``,
      `System channel: ${guild.system_channel_id ? `\`${guild.system_channel_id}\`` : '(none)'}`,
    ].join('\n');
    return ok(text, {
      guild: { name: guild.name, id: guild.id, system_channel_id: guild.system_channel_id ?? null },
    });
  },
};

// ── discord_update_guild ──────────────────────────────────────────────────────

const updateGuildTool: RegisteredTool = {
  name: 'discord_update_guild',
  title: 'Update Guild',
  description:
    'Modifies an existing guild: name, description, verification level (0-4), default message notifications (0-1), explicit content filter (0-2), system channel, afk channel, afk timeout (60-43200s), icon, or banner (base64 data URIs). ' +
    'Example: {"guild_id": "123456789012345678", "name": "New Name", "description": "We do things here"}. ' +
    'Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token), otherwise discord_assert_control is suggested. ' +
    'Dry-run by default; set dry_run=false to apply.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      name: z.string().min(2).max(100).optional(),
      description: z.string().max(1024).optional().describe('Guild description (shown in server browsing and invites).'),
      verification_level: z.number().int().min(0).max(4).optional(),
      default_message_notifications: z.number().int().min(0).max(1).optional(),
      explicit_content_filter: z.number().int().min(0).max(2).optional(),
      system_channel_id: z.string().min(1).max(32).optional(),
      afk_channel_id: z.string().min(1).max(32).optional(),
      afk_timeout: z
        .number()
        .int()
        .min(60)
        .max(43200)
        .optional()
        .describe('AFK timeout in seconds (valid: 60, 300, 900, 1800, 3600).'),
      icon: z.string().optional().describe('Base64 data URI for the guild icon (null removes it).'),
      banner: z.string().optional().describe('Base64 data URI for the guild banner (requires BANNER feature).'),
      reason: reasonSchema,
      dry_run: dryRunSchema,
    })
    .strict(),
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const dryRun = (params.dry_run as boolean | undefined) ?? true;

    const body: RESTPatchAPIGuildJSONBody = {};
    if (params.name !== undefined) body.name = params.name as string;
    if (params.description !== undefined) body.description = params.description as string;
    if (params.verification_level !== undefined) body.verification_level = params.verification_level as RESTPatchAPIGuildJSONBody['verification_level'];
    if (params.default_message_notifications !== undefined)
      body.default_message_notifications = params.default_message_notifications as RESTPatchAPIGuildJSONBody['default_message_notifications'];
    if (params.explicit_content_filter !== undefined)
      body.explicit_content_filter = params.explicit_content_filter as RESTPatchAPIGuildJSONBody['explicit_content_filter'];
    if (params.system_channel_id !== undefined) body.system_channel_id = params.system_channel_id as string;
    if (params.afk_channel_id !== undefined) body.afk_channel_id = params.afk_channel_id as string;
    if (params.afk_timeout !== undefined) body.afk_timeout = params.afk_timeout as RESTPatchAPIGuildJSONBody['afk_timeout'];
    if (params.icon !== undefined) body.icon = params.icon as string;
    if (params.banner !== undefined) body.banner = params.banner as string;

    const fields = Object.keys(body);
    if (fields.length === 0) {
      return fail('No updatable fields provided. Pass at least one of name, description, verification_level, default_message_notifications, explicit_content_filter, system_channel_id, afk_channel_id, afk_timeout, icon, banner.');
    }

    if (dryRun) {
      const text = [
        `🔍 Dry run: no changes applied. Guild \`${guildId}\` would be updated with:`,
        ...fields.map((f) => `- ${f}: \`${JSON.stringify(body[f as keyof RESTPatchAPIGuildJSONBody])}\``),
        `Set dry_run=false to apply (reason: "${resolveReason(params.reason as string | undefined)}").`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: { guild_id: guildId, ...body } });
    }

    await guard(guildId, ctx);
    const guild = await ctx.client.updateGuild(guildId, body, { reason: resolveReason(params.reason as string | undefined) });
    const text = [
      `✅ Guild updated: **${guild.name}** \`${guild.id}\``,
      `Changed fields: ${fields.join(', ')}`,
      `Audit reason: "${resolveReason(params.reason as string | undefined)}"`,
    ].join('\n');
    return ok(text, { guild: { id: guild.id, name: guild.name }, changed_fields: fields });
  },
};

// ── discord_delete_guild ──────────────────────────────────────────────────────

const deleteGuildTool: RegisteredTool = {
  name: 'discord_delete_guild',
  title: 'Delete Guild (irreversible)',
  description:
    'Permanently deletes a guild and ALL of its content: channels, roles, messages, emoji, and integrations. This cannot be undone. ' +
    'Example: {"guild_id": "123456789012345678", "dry_run": false}. ' +
    'Sovereignty-guarded: requires the client to own the guild (user token; bots cannot delete guilds). ' +
    'Dry-run by default; set dry_run=false to actually delete.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      dry_run: dryRunSchema,
    })
    .strict(),
  annotations: { destructiveHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const dryRun = (params.dry_run as boolean | undefined) ?? true;

    if (dryRun) {
      const text = [
        `🔍 Dry run: nothing deleted. Guild \`${guildId}\` would be **permanently destroyed**:`,
        `- All channels, messages, and threads`,
        `- All roles and their assignments`,
        `- All emoji, stickers, and integrations`,
        `- The guild cannot be recovered by any means`,
        `Set dry_run=false to confirm deletion.`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: { guild_id: guildId } });
    }

    await guard(guildId, ctx);
    await ctx.client.deleteGuild(guildId);
    return ok(
      `✅ Guild \`${guildId}\` has been permanently deleted. This cannot be undone.`,
      { guild_id: guildId, deleted: true }
    );
  },
};

// ── discord_list_roles ────────────────────────────────────────────────────────

const listRolesTool: RegisteredTool = {
  name: 'discord_list_roles',
  title: 'List Roles',
  description:
    'Lists every role in a guild, ordered highest->lowest position (as returned by the API), paginated. Each entry shows the role id, name, position, color hex, hoist/mentionable/managed flags, and resolved permission names. ' +
    'Example: {"guild_id": "123456789012345678", "limit": 50}. ' +
    'Fails when the guild does not exist or the client cannot see it.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      limit: limitSchema,
      offset: offsetSchema,
    })
    .strict(),
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const limit = (params.limit as number | undefined) ?? 20;
    const offset = (params.offset as number | undefined) ?? 0;
    const roles = await ctx.client.getRoles(guildId);
    const page = paginate(roles, { limit, offset });
    const items = page.items.map((r: APIRole) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      color: `#${r.color.toString(16).padStart(6, '0')}`,
      hoist: r.hoist,
      mentionable: r.mentionable,
      managed: r.managed,
      permissions: bitsToPermissionNames(BigInt(r.permissions)),
    }));
    const lines = page.items.map(
      (r: APIRole, i: number) => `${offset + i + 1}. ${fmtRole(r)} · perms: ${fmtPermissions(bitsToPermissionNames(BigInt(r.permissions)))}`
    );
    const header = `**Roles in \`${guildId}\`** (${roles.length} total, showing ${offset + 1}-${offset + page.page.count})`;
    const next = page.page.has_more ? `\nNext page: set offset=${page.page.next_offset}.` : '';
    return ok(`${[header, ...lines].join('\n')}${next}`, { roles: items, page: page.page });
  },
};

// ── discord_get_role ──────────────────────────────────────────────────────────

const getRoleTool: RegisteredTool = {
  name: 'discord_get_role',
  title: 'Get Role',
  description:
    'Fetches a single role by id within a guild: name, position, color hex, hoist/mentionable/managed flags, permission names, and the raw permission bitfield as a decimal string. ' +
    'Example: {"guild_id": "123456789012345678", "role_id": "987654321098765432"}. ' +
    'Fails when the role or guild does not exist.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      role_id: roleIdSchema,
    })
    .strict(),
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const roleId = params.role_id as string;
    const roles = await ctx.client.getRoles(guildId);
    const role = roles.find((r: APIRole) => r.id === roleId);
    if (!role) {
      return fail(`Role \`${roleId}\` not found in guild \`${guildId}\`. Re-run discord_list_roles for current role IDs.`, {
        guild_id: guildId,
        role_id: roleId,
      });
    }
    const bitfield = BigInt(role.permissions).toString();
    const permissions = bitsToPermissionNames(BigInt(role.permissions));
    const text = [`**Role**`, fmtRole(role), `Permissions: ${fmtPermissions(permissions)}`, `Bitfield: \`${bitfield}\``].join('\n');
    return ok(text, {
      role: {
        id: role.id,
        name: role.name,
        position: role.position,
        color: `#${role.color.toString(16).padStart(6, '0')}`,
        hoist: role.hoist,
        mentionable: role.mentionable,
        managed: role.managed,
        permissions_bitfield: bitfield,
        permissions_names: permissions,
      },
    });
  },
};

// ── discord_create_role ───────────────────────────────────────────────────────

const createRoleTool: RegisteredTool = {
  name: 'discord_create_role',
  title: 'Create Role',
  description:
    'Creates a new role in a guild with an optional name, permission names (e.g. ["ManageRoles", "KickMembers"]), color (#hex, 0xhex, decimal, or named palette), hoist, and mentionable. ' +
    'Example: {"guild_id": "123456789012345678", "name": "Mod", "permissions": ["ManageRoles", "BanMembers"], "color": "#e74c3c", "dry_run": false}. ' +
    'Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). ' +
    'Fails on unknown permission names, invalid colors, or the 250-role cap. Dry-run by default.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      name: z.string().min(1).max(100).optional().describe('Role name (defaults to "new role").'),
      permissions: permissionsSchema,
      color: colorSchema,
      hoist: z.boolean().optional().describe('Show role members separately in the sidebar.'),
      mentionable: z.boolean().optional().describe('Allow the role to be mentioned by anyone.'),
      reason: reasonSchema,
      dry_run: dryRunSchema,
    })
    .strict(),
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const dryRun = (params.dry_run as boolean | undefined) ?? true;

    let body: RESTPostAPIGuildRoleJSONBody;
    try {
      body = buildCreateRoleBody(params as CreateRoleInput);
      if (params.name !== undefined) body.name = params.name as string;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    if (dryRun) {
      const previewPermissions = body.permissions != null ? bitsToPermissionNames(BigInt(body.permissions)) : [];
      const text = [
        `🔍 Dry run: no role created. Role would be created in \`${guildId}\`:`,
        `- Name: ${body.name ?? 'new role'}`,
        `- Permissions: ${fmtPermissions(previewPermissions)}${body.permissions != null ? ` (bitfield \`${body.permissions}\`)` : ''}`,
        `- Color: ${body.color != null ? `#${body.color.toString(16).padStart(6, '0')}` : '(default)'}`,
        `- Hoist: ${body.hoist ?? false} · Mentionable: ${body.mentionable ?? false}`,
        `Set dry_run=false to create it.`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: { guild_id: guildId, ...body } });
    }

    await guard(guildId, ctx);
    const role = await ctx.client.createRole(guildId, body, { reason: resolveReason(params.reason as string | undefined) });
    const permissions = bitsToPermissionNames(BigInt(role.permissions));
    const text = [
      `✅ Role created: **@${role.name}** \`${role.id}\``,
      `Position: ${role.position} · Color: #${role.color.toString(16).padStart(6, '0')}`,
      `Permissions: ${fmtPermissions(permissions)}`,
    ].join('\n');
    return ok(text, {
      role: {
        id: role.id,
        name: role.name,
        position: role.position,
        permissions_bitfield: role.permissions,
        permissions_names: permissions,
      },
    });
  },
};

// ── discord_update_role ───────────────────────────────────────────────────────

const updateRoleTool: RegisteredTool = {
  name: 'discord_update_role',
  title: 'Update Role',
  description:
    'Modifies an existing role: name, permissions, color, hoist, mentionable, icon (data URI), or unicode_emoji. IMPORTANT: when permissions is provided it REPLACES the role\'s entire permission set: ' +
    'omit it to leave permissions untouched. ' +
    'Example: {"guild_id": "123456789012345678", "role_id": "987654321098765432", "name": "Senior Mod", "color": "#f1c40f", "dry_run": false}. ' +
    'Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). ' +
    'Fails on unknown permission names, invalid colors, or roles above the client in the hierarchy. Dry-run by default.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      role_id: roleIdSchema,
      name: z.string().min(1).max(100).optional(),
      permissions: permissionsSchema,
      color: colorSchema,
      hoist: z.boolean().optional(),
      mentionable: z.boolean().optional(),
      icon: z.string().optional().describe('Base64 data URI for the role icon (requires ROLE_ICONS feature).'),
      unicode_emoji: z.string().optional().describe('Standard unicode emoji for the role icon.'),
      reason: reasonSchema,
      dry_run: dryRunSchema,
    })
    .strict(),
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const roleId = params.role_id as string;
    const dryRun = (params.dry_run as boolean | undefined) ?? true;

    const body: RESTPatchAPIGuildRoleJSONBody = {};
    try {
      if (params.name !== undefined) body.name = params.name as string;
      if (params.permissions !== undefined) body.permissions = permissionNamesToBits(params.permissions as string[]).toString();
      if (params.color !== undefined) body.color = parseColor(params.color as string);
      if (params.hoist !== undefined) body.hoist = params.hoist as boolean;
      if (params.mentionable !== undefined) body.mentionable = params.mentionable as boolean;
      if (params.icon !== undefined) body.icon = params.icon as string;
      if (params.unicode_emoji !== undefined) body.unicode_emoji = params.unicode_emoji as string;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const fields = Object.keys(body);
    if (fields.length === 0) {
      return fail('No updatable fields provided. Pass at least one of name, permissions, color, hoist, mentionable, icon, unicode_emoji.');
    }

    if (dryRun) {
      const lines = fields.map((f) => {
        const value = body[f as keyof RESTPatchAPIGuildRoleJSONBody];
        const display = f === 'permissions' && value !== undefined ? `${fmtPermissions(bitsToPermissionNames(BigInt(value as string)))} (bitfield \`${value}\`)` : JSON.stringify(value);
        return `- ${f}: ${display}`;
      });
      const text = [
        `🔍 Dry run: no changes applied. Role \`${roleId}\` in \`${guildId}\` would be updated with:`,
        ...lines,
        `Set dry_run=false to apply (reason: "${resolveReason(params.reason as string | undefined)}").`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: { guild_id: guildId, role_id: roleId, ...body } });
    }

    await guard(guildId, ctx);
    const role = await ctx.client.updateRole(guildId, roleId, body, { reason: resolveReason(params.reason as string | undefined) });
    const permissions = bitsToPermissionNames(BigInt(role.permissions));
    const text = [
      `✅ Role updated: **@${role.name}** \`${role.id}\``,
      `Position: ${role.position} · Color: #${role.color.toString(16).padStart(6, '0')}`,
      `Permissions: ${fmtPermissions(permissions)}`,
    ].join('\n');
    return ok(text, {
      role: {
        id: role.id,
        name: role.name,
        position: role.position,
        permissions_bitfield: role.permissions,
        permissions_names: permissions,
      },
    });
  },
};

// ── discord_delete_role ───────────────────────────────────────────────────────

const deleteRoleTool: RegisteredTool = {
  name: 'discord_delete_role',
  title: 'Delete Role (irreversible)',
  description:
    'Permanently deletes a role from a guild. Every member holding the role loses it immediately: any permissions, colors, and channel overwrites tied to the role vanish. ' +
    'Example: {"guild_id": "123456789012345678", "role_id": "987654321098765432", "dry_run": false}. ' +
    'Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). ' +
    'Fails when the role does not exist or is above the client in the hierarchy. Dry-run by default.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      role_id: roleIdSchema,
      reason: reasonSchema,
      dry_run: dryRunSchema,
    })
    .strict(),
  annotations: { destructiveHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const roleId = params.role_id as string;
    const dryRun = (params.dry_run as boolean | undefined) ?? true;

    if (dryRun) {
      const text = [
        `🔍 Dry run: nothing deleted. Role \`${roleId}\` in guild \`${guildId}\` would be **permanently removed**:`,
        `- Every member holding it loses the role`,
        `- Its permissions, color, and channel overwrites disappear`,
        `- Any integrations or bots bound to the role break`,
        `Set dry_run=false to confirm deletion.`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: { guild_id: guildId, role_id: roleId } });
    }

    await guard(guildId, ctx);
    await ctx.client.deleteRole(guildId, roleId, { reason: resolveReason(params.reason as string | undefined) });
    return ok(
      `✅ Role \`${roleId}\` deleted from guild \`${guildId}\`. Members who held it no longer have it.`,
      { guild_id: guildId, role_id: roleId, deleted: true }
    );
  },
};

// ── discord_reorder_roles ─────────────────────────────────────────────────────

const reorderRolesTool: RegisteredTool = {
  name: 'discord_reorder_roles',
  title: 'Reorder Roles',
  description:
    'Reorders roles in a guild by assigning each listed role a new position. IMPORTANT: only roles BELOW the acting identity\'s highest role can be moved (Discord hierarchy rules), and positions are applied sequentially in array order. ' +
    'The @everyone role always sits at position 0. ' +
    'Example: {"guild_id": "123456789012345678", "positions": [{"role_id": "111111111111111111", "position": 2}, {"role_id": "222222222222222222", "position": 1}]}. ' +
    'Sovereignty-guarded: requires the client to own the guild (user token) or hold the #1 role (bot token). ' +
    'Fails when a role is above the client or does not exist. Dry-run by default.',
  inputSchema: z
    .object({
      guild_id: guildIdSchema,
      positions: z
        .array(
          z
            .object({
              role_id: roleIdSchema,
              position: z.number().int().min(0).describe('New sorting position for this role.'),
            })
            .strict()
        )
        .min(1)
        .describe('Roles and their new positions, applied sequentially in array order.'),
      reason: reasonSchema,
      dry_run: dryRunSchema,
    })
    .strict(),
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const guildId = params.guild_id as string;
    const dryRun = (params.dry_run as boolean | undefined) ?? true;
    const positions = (params.positions as { role_id: string; position: number }[]).map((p) => ({
      id: p.role_id,
      position: p.position,
    }));

    if (dryRun) {
      const lines = positions.map((p) => `- \`${p.id}\` -> position ${p.position}`);
      const text = [
        `🔍 Dry run: no changes applied. Roles in \`${guildId}\` would be reordered (sequentially, in this order):`,
        ...lines,
        `Set dry_run=false to apply (reason: "${resolveReason(params.reason as string | undefined)}").`,
      ].join('\n');
      return ok(text, { dry_run: true, would_execute: { guild_id: guildId, positions } });
    }

    await guard(guildId, ctx);
    const roles = await ctx.client.reorderRoles(guildId, positions, { reason: resolveReason(params.reason as string | undefined) });
    const updated = roles.map((r: APIRole) => ({ id: r.id, name: r.name, position: r.position }));
    const lines = updated.map((r) => `- **@${r.name}** \`${r.id}\` -> position ${r.position}`);
    return ok(`✅ Roles reordered in \`${guildId}\`:\n${lines.join('\n')}`, { roles: updated });
  },
};

// ── discord_resolve_permissions ───────────────────────────────────────────────

const resolvePermissionsTool: RegisteredTool = {
  name: 'discord_resolve_permissions',
  title: 'Resolve Permissions',
  description:
    'Read-only permission resolver. Given permission names -> returns the combined bitfield (decimal string). Given a bitfield (decimal or 0x hex) -> returns the resolved permission names. ' +
    'Given neither -> returns the full catalog of every valid permission name with its bit value. ' +
    'Examples: {"permissions": ["ManageRoles", "KickMembers"]} -> bitfield; {"bitfield": "8"} -> ["KickMembers"]; {} -> catalog. ' +
    'Fails on unknown permission names (the error lists every valid name) or a malformed bitfield.',
  inputSchema: z
    .object({
      permissions: permissionsSchema,
      bitfield: z
        .string()
        .optional()
        .describe('Permission bitfield as a decimal string (e.g. "104324681") or 0x hex (e.g. "0x637a41").'),
    })
    .strict(),
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, _ctx: ToolContext): Promise<MCPResult> => {
    const namesInput = params.permissions as string[] | undefined;
    const bitfieldInput = params.bitfield as string | undefined;

    if (namesInput !== undefined && namesInput.length > 0) {
      let bits: bigint;
      try {
        bits = permissionNamesToBits(namesInput);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      const text = [
        `**Permission names -> bitfield**`,
        `Names (${namesInput.length}): ${fmtPermissions(namesInput)}`,
        `Bitfield: \`${bits.toString()}\``,
      ].join('\n');
      const structured: Record<string, unknown> = {
        bitfield: bits.toString(),
        names: namesInput,
        count: namesInput.length,
      };
      if (bitfieldInput !== undefined) {
        const parsed = parseBitfield(bitfieldInput);
        structured.input_bitfield = bitfieldInput;
        if (parsed !== bits) {
          structured.matches_input_bitfield = false;
        }
      }
      return ok(text, structured);
    }

    if (bitfieldInput !== undefined) {
      let bits: bigint;
      try {
        bits = parseBitfield(bitfieldInput);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      const names = bitsToPermissionNames(bits);
      return ok(
        `**Bitfield -> permission names**\nBitfield: \`${bits.toString()}\`\nNames (${names.length}): ${fmtPermissions(names)}`,
        { bitfield: bits.toString(), names, count: names.length }
      );
    }

    const catalog = ALL_PERMISSION_NAMES.map((name) => ({
      name,
      bit: PERMISSION_BITS[name]!.toString(),
    }));
    const lines = catalog.map((c) => `- **${c.name}**: \`${c.bit}\``);
    return ok(`**All ${catalog.length} permissions**\n${lines.join('\n')}`, {
      catalog,
      count: catalog.length,
    });
  },
};

export const guildTools: RegisteredTool[] = [
  whoamiTool,
  listGuildsTool,
  getGuildTool,
  createGuildTool,
  updateGuildTool,
  deleteGuildTool,
  listRolesTool,
  getRoleTool,
  createRoleTool,
  updateRoleTool,
  deleteRoleTool,
  reorderRolesTool,
  resolvePermissionsTool,
];