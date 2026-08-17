import { z } from 'zod';
import { MessageFlags } from 'discord-api-types/v10';
import type { APIBan, APIEmbed, APIEmbedAuthor, APIEmbedField, APIEmbedFooter, APIGuildMember, APIMessage } from 'discord-api-types/payloads/v10';
import type {
  RESTPatchAPIGuildMemberJSONBody,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageJSONBody,
  RESTPutAPIGuildBanJSONBody,
} from 'discord-api-types/rest/v10';
import type { MCPResult, RegisteredTool, ToolInput } from './registry.js';
import { fail, ok } from './registry.js';
import {
  afterSchema,
  beforeSchema,
  channelIdSchema,
  dryRunSchema,
  guildIdSchema,
  limitSchema,
  messageIdSchema,
  offsetSchema,
  reasonSchema,
  roleIdSchema,
  userIdSchema,
} from './sharedSchemas.js';
import { DEFAULT_AUDIT_REASON, TIMEOUT_MAX_MINUTES } from '../constants.js';
import { fmtBan, fmtMember, fmtMessage, paginate, truncate } from '../utils/format.js';
import { parseColor } from '../services/permissionService.js';

const membersLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(100)
  .describe('Number of members to return (1-1000).');

const searchLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(25)
  .describe('Number of matching members to return (1-1000).');

const messagesLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(50)
  .describe('Number of messages to return (1-100).');

const purgeLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(100)
  .describe('Maximum number of messages to purge (1-100).');

const timeoutMinutesSchema = z
  .number()
  .int()
  .min(0)
  .max(TIMEOUT_MAX_MINUTES)
  .optional()
  .describe(
    'Timeout duration in minutes (1-40320, i.e. up to 28 days). Sent to Discord as communication_disabled_until = now + minutes. Set 0 to remove an active timeout.'
  );

const embedFieldSchema = z
  .object({
    name: z.string().min(1).max(256).describe('Field name (max 256 chars).'),
    value: z.string().min(1).max(1024).describe('Field value (max 1024 chars).'),
    inline: z.boolean().optional().describe('Render this field inline with adjacent fields.'),
  })
  .strict();

const embedSchema = z
  .object({
    title: z.string().max(256).optional().describe('Embed title (max 256 chars).'),
    description: z.string().max(4000).optional().describe('Embed description (max 4000 chars).'),
    color: z
      .union([z.string(), z.number().int()])
      .optional()
      .describe("Embed accent color: '#RRGGBB' (e.g. '#e74c3c'), 0xRRGGBB, a decimal integer, or a named color (red, green, blue, purple, gold, blurple, ...)."),
    fields: z.array(embedFieldSchema).max(10).optional().describe('Up to 10 fields.'),
    footer_text: z.string().max(2048).optional().describe('Footer text (max 2048 chars).'),
    footer_icon_url: z.string().url().optional().describe('Footer icon URL.'),
    image_url: z.string().url().optional().describe('Large image URL.'),
    thumbnail_url: z.string().url().optional().describe('Thumbnail URL (top-right).'),
    author_name: z.string().max(256).optional().describe('Author name (max 256 chars).'),
    author_icon_url: z.string().url().optional().describe('Author icon URL.'),
    url: z.string().url().optional().describe('Link target for the embed title.'),
  })
  .strict();

function memberListStructured(m: APIGuildMember): Record<string, unknown> {
  return {
    id: m.user?.id ?? null,
    username: m.user?.username ?? null,
    global_name: m.user?.global_name ?? null,
    nick: m.nick ?? null,
    roles_count: m.roles.length,
    joined_at: m.joined_at,
    timeout_until: m.communication_disabled_until ?? null,
  };
}

function memberDetailStructured(m: APIGuildMember): Record<string, unknown> {
  return {
    id: m.user?.id ?? null,
    username: m.user?.username ?? null,
    global_name: m.user?.global_name ?? null,
    nick: m.nick ?? null,
    avatar: m.avatar ?? m.user?.avatar ?? null,
    roles: m.roles,
    joined_at: m.joined_at,
    premium_since: m.premium_since ?? null,
    timeout_until: m.communication_disabled_until ?? null,
    flags: m.flags,
    pending: m.pending ?? false,
  };
}

function messageListStructured(m: APIMessage): Record<string, unknown> {
  return {
    id: m.id,
    author_id: m.author?.id ?? null,
    author_username: m.author?.username ?? null,
    timestamp: m.timestamp,
    content: truncate(m.content ?? '', 4000),
    attachments_count: m.attachments?.length ?? 0,
    embeds_count: m.embeds?.length ?? 0,
    pinned: m.pinned,
  };
}

/** Builds an APIEmbed from the shared embed input schema; returns null when nothing usable was provided. */
function buildEmbed(input: Record<string, unknown>): APIEmbed | null {
  const embed: APIEmbed = {};
  let any = false;
  if (typeof input.title === 'string' && input.title.length > 0) {
    embed.title = input.title;
    any = true;
  }
  if (typeof input.description === 'string' && input.description.length > 0) {
    embed.description = input.description;
    any = true;
  }
  if (input.color !== undefined) {
    embed.color = parseColor(String(input.color));
    any = true;
  }
  if (Array.isArray(input.fields) && input.fields.length > 0) {
    embed.fields = input.fields.map((raw) => {
      const f = raw as Record<string, unknown>;
      const field: APIEmbedField = {
        name: String(f.name ?? ''),
        value: String(f.value ?? ''),
      };
      if (typeof f.inline === 'boolean') field.inline = f.inline;
      return field;
    });
    any = true;
  }
  if (typeof input.footer_text === 'string' && input.footer_text.length > 0) {
    const footer: APIEmbedFooter = { text: input.footer_text };
    if (typeof input.footer_icon_url === 'string') footer.icon_url = input.footer_icon_url;
    embed.footer = footer;
    any = true;
  }
  if (typeof input.image_url === 'string' && input.image_url.length > 0) {
    embed.image = { url: input.image_url };
    any = true;
  }
  if (typeof input.thumbnail_url === 'string' && input.thumbnail_url.length > 0) {
    embed.thumbnail = { url: input.thumbnail_url };
    any = true;
  }
  if (typeof input.author_name === 'string' && input.author_name.length > 0) {
    const author: APIEmbedAuthor = { name: input.author_name };
    if (typeof input.author_icon_url === 'string') author.icon_url = input.author_icon_url;
    embed.author = author;
    any = true;
  }
  if (typeof input.url === 'string' && input.url.length > 0) {
    embed.url = input.url;
    any = true;
  }
  return any ? embed : null;
}

function safeReason(params: ToolInput): string {
  return typeof params.reason === 'string' && params.reason.length > 0 ? params.reason : DEFAULT_AUDIT_REASON;
}

function num(params: ToolInput, key: string, fallback: number, min: number, max: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback;
}

export const memberTools: RegisteredTool[] = [
  {
    name: 'discord_list_members',
    title: 'List guild members',
    description:
      'Lists members of a guild, newest members first. Use when you need an overview of who is in a server, member counts, or to find a member ID. Example: { guild_id: "123", limit: 100 }. Pass the previous response\'s next_after as `after` to page through large servers.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        limit: membersLimitSchema,
        after: afterSchema,
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const limit = num(params, 'limit', 100, 1, 1000);
      const after = typeof params.after === 'string' ? params.after : undefined;
      const members = await ctx.client.listMembers(guildId, { limit, after });
      const last = members.length > 0 ? members[members.length - 1] : undefined;
      const text = members.length > 0 ? members.map(fmtMember).join('\n') : 'No members found.';
      return ok(text, {
        guild_id: guildId,
        members: members.map(memberListStructured),
        pagination: {
          count: members.length,
          limit,
          after_used: after ?? null,
          next_after: last?.user?.id ?? null,
          has_more: members.length === limit,
        },
      });
    },
  },
  {
    name: 'discord_search_members',
    title: 'Search guild members',
    description:
      'Searches guild members by username or nickname (1-32 characters, case-insensitive). Use when you need to find a specific member without paging through the whole member list. Example: { guild_id: "123", query: "alice", limit: 25 }.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        query: z
          .string()
          .min(1)
          .max(32)
          .describe('Search query: username or nickname fragment (1-32 chars).'),
        limit: searchLimitSchema,
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const query = String(params.query);
      const limit = num(params, 'limit', 25, 1, 1000);
      const members = await ctx.client.searchMembers(guildId, query, limit);
      const text = members.length > 0 ? members.map(fmtMember).join('\n') : `No members matched "${query}".`;
      return ok(text, {
        guild_id: guildId,
        query,
        members: members.map(memberListStructured),
        pagination: {
          count: members.length,
          limit,
          has_more: members.length === limit,
        },
      });
    },
  },
  {
    name: 'discord_get_member',
    title: 'Get guild member',
    description:
      'Fetches a single guild member by user ID, including nickname, full role list, join date, boost status and timeout. Use before updating a member to see their current state. Example: { guild_id: "123", user_id: "456" }.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const member = await ctx.client.getMember(guildId, userId);
      return ok(fmtMember(member), {
        guild_id: guildId,
        member: memberDetailStructured(member),
      });
    },
  },
  {
    name: 'discord_update_member',
    title: 'Update guild member',
    description:
      'Updates a guild member: nickname, roles and/or timeout. WARNING: `roles` REPLACES the member\'s ENTIRE role set — pass every role ID the member should have, or omit `roles` to leave roles untouched. `nick` may be an empty string to clear the nickname. `timeout_minutes` is 1-40320 (28 days max); 0 removes an active timeout. Cannot mute or deafen the member in voice — that requires a gateway connection, not this endpoint. Administrative: requires the sovereignty guard when dry_run=false. Example: { guild_id: "123", user_id: "456", nick: "new name", timeout_minutes: 30 }.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
        nick: z
          .string()
          .max(32)
          .optional()
          .describe('New nickname (max 32 chars). Pass an empty string to clear the nickname.'),
        roles: z
          .array(roleIdSchema)
          .max(250)
          .optional()
          .describe('FULL replacement role set for the member (max 250 role IDs). Omitting this leaves roles unchanged.'),
        timeout_minutes: timeoutMinutesSchema,
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true, idempotentHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);
      const nick = typeof params.nick === 'string' ? params.nick : undefined;
      const roles = Array.isArray(params.roles) ? (params.roles as string[]) : undefined;
      const timeoutMinutes = typeof params.timeout_minutes === 'number' ? params.timeout_minutes : undefined;

      let communicationDisabledUntil: string | null | undefined;
      if (timeoutMinutes !== undefined) {
        communicationDisabledUntil =
          timeoutMinutes === 0 ? null : new Date(Date.now() + timeoutMinutes * 60_000).toISOString();
      }

      const body: RESTPatchAPIGuildMemberJSONBody = {};
      if (nick !== undefined) body.nick = nick.length === 0 ? null : nick;
      if (roles !== undefined) body.roles = roles;
      if (communicationDisabledUntil !== undefined) body.communication_disabled_until = communicationDisabledUntil;

      if (Object.keys(body).length === 0) {
        return fail('Nothing to update: provide at least one of nick, roles or timeout_minutes.');
      }

      const applied: Record<string, unknown> = {};
      if (nick !== undefined) applied.nick = body.nick;
      if (roles !== undefined) applied.roles = body.roles;
      if (communicationDisabledUntil !== undefined) applied.communication_disabled_until = body.communication_disabled_until;

      if (dryRun) {
        return ok(`[dry-run] Would update member <@${userId}> in guild ${guildId} with ${JSON.stringify(applied)}.`, {
          dry_run: true,
          guild_id: guildId,
          user_id: userId,
          would_execute: applied,
          reason,
        });
      }

      await ctx.control.assertControl(guildId);
      await ctx.client.updateMember(guildId, userId, body, { reason });
      return ok(`✅ Updated member <@${userId}> in guild ${guildId}: ${Object.keys(applied).join(', ') || 'no fields'}.`, {
        guild_id: guildId,
        user_id: userId,
        applied,
        reason,
      });
    },
  },
  {
    name: 'discord_add_member_role',
    title: 'Add role to member',
    description:
      'Adds a single role to a guild member. Use when granting a role (e.g. verified, muted-by-role, member). Example: { guild_id: "123", user_id: "456", role_id: "789" }. Administrative: requires the sovereignty guard when dry_run=false.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
        role_id: roleIdSchema,
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true, idempotentHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const roleId = String(params.role_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      if (dryRun) {
        return ok(`[dry-run] Would add role ${roleId} to member <@${userId}> in guild ${guildId}.`, {
          dry_run: true,
          guild_id: guildId,
          user_id: userId,
          role_id: roleId,
          reason,
        });
      }

      await ctx.control.assertControl(guildId);
      await ctx.client.addMemberRole(guildId, userId, roleId, { reason });
      return ok(`✅ Added role \`${roleId}\` to member <@${userId}> in guild ${guildId}.`, {
        guild_id: guildId,
        user_id: userId,
        role_id: roleId,
        reason,
      });
    },
  },
  {
    name: 'discord_remove_member_role',
    title: 'Remove role from member',
    description:
      'Removes a single role from a guild member. Use when revoking a role (e.g. removing a muted-by-role, stripping an elevated permission). Example: { guild_id: "123", user_id: "456", role_id: "789" }. Administrative: requires the sovereignty guard when dry_run=false.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
        role_id: roleIdSchema,
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true, idempotentHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const roleId = String(params.role_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      if (dryRun) {
        return ok(`[dry-run] Would remove role ${roleId} from member <@${userId}> in guild ${guildId}.`, {
          dry_run: true,
          guild_id: guildId,
          user_id: userId,
          role_id: roleId,
          reason,
        });
      }

      await ctx.control.assertControl(guildId);
      await ctx.client.removeMemberRole(guildId, userId, roleId, { reason });
      return ok(`✅ Removed role \`${roleId}\` from member <@${userId}> in guild ${guildId}.`, {
        guild_id: guildId,
        user_id: userId,
        role_id: roleId,
        reason,
      });
    },
  },
  {
    name: 'discord_kick_member',
    title: 'Kick member',
    description:
      'Removes a member from the guild. WARNING: the member can rejoin via any invite — use discord_ban_member to prevent re-entry. Example: { guild_id: "123", user_id: "456" }. Administrative: requires the sovereignty guard when dry_run=false.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      if (dryRun) {
        return ok(`[dry-run] Would kick member <@${userId}> from guild ${guildId}.`, {
          dry_run: true,
          guild_id: guildId,
          user_id: userId,
          reason,
        });
      }

      await ctx.control.assertControl(guildId);
      await ctx.client.removeMember(guildId, userId, { reason });
      return ok(`✅ Kicked member <@${userId}> from guild ${guildId}.`, {
        guild_id: guildId,
        user_id: userId,
        reason,
      });
    },
  },
  {
    name: 'discord_ban_member',
    title: 'Ban member',
    description:
      'Bans a member from the guild and optionally deletes their recent messages (0-7 days). Use for serious rule violations or to permanently remove a user. Example: { guild_id: "123", user_id: "456", delete_message_days: 1 }. Administrative: requires the sovereignty guard when dry_run=false.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
        delete_message_days: z
          .number()
          .int()
          .min(0)
          .max(7)
          .default(0)
          .describe('Number of days of the user\'s recent messages to delete (0-7, default 0 = keep messages).'),
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const deleteMessageDays = num(params, 'delete_message_days', 0, 0, 7);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      if (dryRun) {
        return ok(`[dry-run] Would ban member <@${userId}> from guild ${guildId} (delete_message_days: ${deleteMessageDays}).`, {
          dry_run: true,
          guild_id: guildId,
          user_id: userId,
          delete_message_days: deleteMessageDays,
          reason,
        });
      }

      await ctx.control.assertControl(guildId);
      const body: RESTPutAPIGuildBanJSONBody = { delete_message_days: deleteMessageDays };
      await ctx.client.banMember(guildId, userId, body, { reason });
      return ok(`✅ Banned member <@${userId}> from guild ${guildId} (delete_message_days: ${deleteMessageDays}).`, {
        guild_id: guildId,
        banned_user_id: userId,
        delete_message_days: deleteMessageDays,
        reason,
      });
    },
  },
  {
    name: 'discord_unban_member',
    title: 'Unban member',
    description:
      'Removes a ban for a user, allowing them to rejoin via invite. Use to restore access after a mistaken or expired ban. Example: { guild_id: "123", user_id: "456" }. Administrative: requires the sovereignty guard when dry_run=false.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      if (dryRun) {
        return ok(`[dry-run] Would unban user <@${userId}> in guild ${guildId}.`, {
          dry_run: true,
          guild_id: guildId,
          user_id: userId,
          reason,
        });
      }

      await ctx.control.assertControl(guildId);
      await ctx.client.unbanMember(guildId, userId, { reason });
      return ok(`✅ Unbanned user <@${userId}> in guild ${guildId}.`, {
        guild_id: guildId,
        user_id: userId,
        reason,
      });
    },
  },
  {
    name: 'discord_list_bans',
    title: 'List guild bans',
    description:
      'Lists all banned users in a guild with ban reasons. Use to audit the ban list or confirm a user is banned before unbanning. Example: { guild_id: "123", limit: 50 }.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        limit: limitSchema,
        offset: offsetSchema,
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const limit = num(params, 'limit', 20, 1, 100);
      const offset = num(params, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
      const bans = await ctx.client.getBans(guildId);
      const page = paginate<APIBan>(bans, { limit, offset });
      const text =
        page.items.length > 0
          ? page.items.map(fmtBan).join('\n')
          : bans.length === 0
            ? 'No bans in this guild.'
            : 'No bans in this page.';
      return ok(text, {
        guild_id: guildId,
        bans: page.items.map((b: APIBan) => ({
          user_id: b.user.id,
          username: b.user.username,
          global_name: b.user.global_name ?? null,
          reason: b.reason ?? null,
          delete_message_seconds:
            'delete_message_seconds' in b
              ? (b as APIBan & { delete_message_seconds?: number }).delete_message_seconds ?? null
              : null,
        })),
        page: page.page,
      });
    },
  },
  {
    name: 'discord_get_ban',
    title: 'Get guild ban',
    description:
      'Fetches the ban record for a single user in a guild, including the ban reason. Use to check why someone was banned or whether they are banned at all. Example: { guild_id: "123", user_id: "456" }.',
    inputSchema: z
      .object({
        guild_id: guildIdSchema,
        user_id: userIdSchema,
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const guildId = String(params.guild_id);
      const userId = String(params.user_id);
      const ban = await ctx.client.getBan(guildId, userId);
      return ok(fmtBan(ban), {
        guild_id: guildId,
        ban: {
          user_id: ban.user.id,
          username: ban.user.username,
          global_name: ban.user.global_name ?? null,
          reason: ban.reason ?? null,
        },
      });
    },
  },
  {
    name: 'discord_send_message',
    title: 'Send message',
    description:
      'Sends a message to a channel: plain text content, a rich embed, or both. At least one of `content` or `embed` is required. Use for announcements, replies, or structured notifications. Example: { channel_id: "123", content: "Hello!", embed: { title: "Deploy", description: "Done", color: "#2ecc71" } }. dry_run defaults to true; no sovereignty guard applies — messaging is not an administrative action.',
    inputSchema: z
      .object({
        channel_id: channelIdSchema,
        content: z
          .string()
          .max(2000)
          .optional()
          .describe('Plain-text message content (max 2000 chars).'),
        embed: embedSchema.optional().describe('Rich embed to attach. See field descriptions for limits.'),
        suppress_embeds: z
          .boolean()
          .optional()
          .describe('True to suppress link previews/embeds on this message (SUPPRESS_EMBEDS flag).'),
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const channelId = String(params.channel_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);
      const content = typeof params.content === 'string' ? params.content : undefined;
      const suppressEmbeds = params.suppress_embeds === true;

      let embed: APIEmbed | null = null;
      if (params.embed !== undefined && typeof params.embed === 'object' && params.embed !== null) {
        try {
          embed = buildEmbed(params.embed as Record<string, unknown>);
        } catch (err) {
          return fail(`Invalid embed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if ((content === undefined || content.length === 0) && embed === null) {
        return fail('Nothing to send: provide at least one of `content` or a non-empty `embed`.');
      }

      const body: RESTPostAPIChannelMessageJSONBody = {};
      if (content !== undefined && content.length > 0) body.content = content;
      if (embed !== null) body.embeds = [embed];
      if (suppressEmbeds) body.flags = MessageFlags.SuppressEmbeds;

      if (dryRun) {
        return ok(`[dry-run] Would send a message to <#${channelId}> (content: ${body.content?.length ?? 0} chars, embeds: ${body.embeds?.length ?? 0}).`, {
          dry_run: true,
          channel_id: channelId,
          would_execute: {
            content: body.content ?? null,
            embeds: body.embeds ?? [],
            flags: body.flags ?? null,
          },
          reason,
        });
      }

      const sent = await ctx.client.sendMessage(channelId, body, { reason });
      return ok(`✅ Sent message \`${sent.id}\` to <#${channelId}>.`, {
        message_id: sent.id,
        channel_id: sent.channel_id,
        timestamp: sent.timestamp,
        content: sent.content,
        embeds_count: sent.embeds?.length ?? 0,
        reason,
      });
    },
  },
  {
    name: 'discord_list_messages',
    title: 'List channel messages',
    description:
      'Lists recent messages in a channel, newest first by default. Use `before` to page older, `after` to page newer, or `around` to center on one message. WARNING: `before`/`after`/`around` are mutually exclusive, and `around` with limit above 100 is invalid. Example: { channel_id: "123", limit: 50, before: "999999999999999999" }.',
    inputSchema: z
      .object({
        channel_id: channelIdSchema,
        limit: messagesLimitSchema,
        before: beforeSchema,
        after: afterSchema,
        around: z
          .string()
          .optional()
          .describe('Snowflake ID cursor: return messages around this ID (centered window).'),
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const channelId = String(params.channel_id);
      const limit = num(params, 'limit', 50, 1, 100);
      const before = typeof params.before === 'string' ? params.before : undefined;
      const after = typeof params.after === 'string' ? params.after : undefined;
      const around = typeof params.around === 'string' ? params.around : undefined;

      const cursorCount = [before, after, around].filter((c) => c !== undefined).length;
      if (cursorCount > 1) {
        return fail('`before`, `after` and `around` are mutually exclusive — pass at most one.');
      }
      if (around !== undefined && limit > 100) {
        return fail('`around` with `limit` above 100 is invalid.');
      }

      const messages = await ctx.client.getMessages(channelId, { limit, before, after, around });
      const first = messages.length > 0 ? messages[0] : undefined;
      const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
      const text = messages.length > 0 ? messages.map(fmtMessage).join('\n') : 'No messages found.';
      return ok(text, {
        channel_id: channelId,
        messages: messages.map(messageListStructured),
        pagination: {
          count: messages.length,
          limit,
          before_used: before ?? null,
          after_used: after ?? null,
          around_used: around ?? null,
          first_id: first?.id ?? null,
          last_id: last?.id ?? null,
          hint: 'Pass last_id as `before` to page older, first_id as `after` to page newer.',
        },
      });
    },
  },
  {
    name: 'discord_get_message',
    title: 'Get message',
    description:
      'Fetches a single message by channel + message ID with full content, author, embeds summary, attachments count, pin state and reply target. Use before editing or deleting a message to verify its state. Example: { channel_id: "123", message_id: "456" }.',
    inputSchema: z
      .object({
        channel_id: channelIdSchema,
        message_id: messageIdSchema,
      })
      .strict(),
    annotations: { readOnlyHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const channelId = String(params.channel_id);
      const messageId = String(params.message_id);
      const fetched = await ctx.client.getMessages(channelId, { around: messageId, limit: 1 });
      const msg = fetched.find((m) => m.id === messageId);
      if (!msg) {
        return fail(`Message ${messageId} not found in channel ${channelId}. It may have been deleted or the client lacks Read Message History.`);
      }
      const embedsSummary = (msg.embeds ?? []).map((e) => ({
        title: e.title ?? null,
        description: e.description ? truncate(e.description, 300) : null,
      }));
      return ok(fmtMessage(msg), {
        channel_id: channelId,
        message: {
          id: msg.id,
          channel_id: msg.channel_id,
          author: {
            id: msg.author?.id ?? null,
            username: msg.author?.username ?? null,
            global_name: msg.author?.global_name ?? null,
          },
          content: truncate(msg.content ?? '', 4000),
          timestamp: msg.timestamp,
          edited_at: msg.edited_timestamp ?? null,
          pinned: msg.pinned,
          embeds: embedsSummary,
          attachments_count: msg.attachments?.length ?? 0,
          reply_to: msg.message_reference?.message_id ?? null,
        },
      });
    },
  },
  {
    name: 'discord_edit_message',
    title: 'Edit message',
    description:
      'Edits an existing message: replace `content` (pass an EMPTY STRING to remove all text), swap the `embed`, or toggle `suppress_embeds`. NOTE: editing a message authored by another user fails with Discord error 20008 — the client can only edit its own messages. Example: { channel_id: "123", message_id: "456", content: "Updated text" }. dry_run defaults to true; no sovereignty guard applies.',
    inputSchema: z
      .object({
        channel_id: channelIdSchema,
        message_id: messageIdSchema,
        content: z
          .string()
          .max(2000)
          .optional()
          .describe('New message content (max 2000 chars). Pass an empty string to remove all text.'),
        embed: embedSchema.optional().describe('Replacement embed. Omit to leave embeds unchanged.'),
        suppress_embeds: z
          .boolean()
          .optional()
          .describe('True to set SUPPRESS_EMBEDS on the message. Cannot reliably un-suppress without the full flag set.'),
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const channelId = String(params.channel_id);
      const messageId = String(params.message_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);
      const content = typeof params.content === 'string' ? params.content : undefined;
      const suppressEmbeds = params.suppress_embeds === true;

      let embed: APIEmbed | null = null;
      if (params.embed !== undefined && typeof params.embed === 'object' && params.embed !== null) {
        try {
          embed = buildEmbed(params.embed as Record<string, unknown>);
        } catch (err) {
          return fail(`Invalid embed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const body: RESTPatchAPIChannelMessageJSONBody = {};
      if (content !== undefined) body.content = content.length === 0 ? null : content;
      if (embed !== null) body.embeds = [embed];
      if (suppressEmbeds) body.flags = MessageFlags.SuppressEmbeds;

      if (Object.keys(body).length === 0) {
        return fail('Nothing to edit: provide at least one of `content`, `embed` or `suppress_embeds`.');
      }

      if (dryRun) {
        return ok(`[dry-run] Would edit message \`${messageId}\` in <#${channelId}> with ${JSON.stringify(body)}.`, {
          dry_run: true,
          channel_id: channelId,
          message_id: messageId,
          would_execute: body,
          reason,
        });
      }

      const edited = await ctx.client.editMessage(channelId, messageId, body, { reason });
      return ok(`✅ Edited message \`${messageId}\` in <#${channelId}>.`, {
        message_id: edited.id,
        channel_id: edited.channel_id,
        edited_at: edited.edited_timestamp ?? null,
        reason,
      });
    },
  },
  {
    name: 'discord_delete_message',
    title: 'Delete message',
    description:
      'Deletes a single message by channel + message ID. Use for removing spam, mistakes or sensitive content. The client can only delete its own messages unless it has Manage Messages. Example: { channel_id: "123", message_id: "456" }. dry_run defaults to true; no sovereignty guard applies.',
    inputSchema: z
      .object({
        channel_id: channelIdSchema,
        message_id: messageIdSchema,
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const channelId = String(params.channel_id);
      const messageId = String(params.message_id);
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      if (dryRun) {
        return ok(`[dry-run] Would delete message \`${messageId}\` in <#${channelId}>.`, {
          dry_run: true,
          channel_id: channelId,
          message_id: messageId,
          reason,
        });
      }

      await ctx.client.deleteMessage(channelId, messageId, { reason });
      return ok(`✅ Deleted message \`${messageId}\` in <#${channelId}>.`, {
        deleted_message_id: messageId,
        channel_id: channelId,
        reason,
      });
    },
  },
  {
    name: 'discord_purge_messages',
    title: 'Purge channel messages',
    description:
      'Bulk-deletes messages in a channel. Fetches up to 100 messages (newer than `after` if given), skips messages older than 14 days (the bulk-delete window) and pinned messages unless `include_pinned`, then deletes them in one bulk call. `limit` caps how many are deleted. Example: { channel_id: "123", limit: 50, after: "999999999999999999" }. Administrative: requires the sovereignty guard when dry_run=false.',
    inputSchema: z
      .object({
        channel_id: channelIdSchema,
        limit: purgeLimitSchema,
        after: afterSchema,
        include_pinned: z
          .boolean()
          .default(false)
          .describe('True to also delete pinned messages (they are skipped by default).'),
        reason: reasonSchema,
        dry_run: dryRunSchema,
      })
      .strict(),
    annotations: { destructiveHint: true },
    handle: async (params, ctx): Promise<MCPResult> => {
      const channelId = String(params.channel_id);
      const limit = num(params, 'limit', 100, 1, 100);
      const after = typeof params.after === 'string' ? params.after : undefined;
      const includePinned = params.include_pinned === true;
      const dryRun = params.dry_run !== false;
      const reason = safeReason(params);

      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const toDelete: string[] = [];
      let skippedPinned = 0;
      let skippedOld = 0;

      const fetchAndFilter = async (): Promise<void> => {
        const fetched = await ctx.client.getMessages(channelId, { limit: 100, after });
        for (const m of fetched) {
          if (m.pinned && !includePinned) {
            skippedPinned += 1;
            continue;
          }
          if (new Date(m.timestamp).getTime() < cutoff) {
            skippedOld += 1;
            continue;
          }
          toDelete.push(m.id);
          if (toDelete.length >= limit) break;
        }
      };

      await fetchAndFilter();

      if (toDelete.length === 0) {
        const note = skippedPinned > 0 || skippedOld > 0 ? ` (skipped ${skippedPinned} pinned, ${skippedOld} older than 14 days)` : '';
        return ok(`Nothing to purge in <#${channelId}>${note}.`, {
          dry_run: dryRun,
          channel_id: channelId,
          purged_count: 0,
          purged_message_ids: [],
          skipped_pinned: skippedPinned,
          skipped_old: skippedOld,
        });
      }

      if (dryRun) {
        return ok(
          `[dry-run] Would purge ${toDelete.length} message(s) in <#${channelId}>: ${toDelete.map((id) => `\`${id}\``).join(', ')} (skipped ${skippedPinned} pinned, ${skippedOld} older than 14 days).`,
          {
            dry_run: true,
            channel_id: channelId,
            would_execute: {
              purged_count: toDelete.length,
              purged_message_ids: toDelete,
              skipped_pinned: skippedPinned,
              skipped_old: skippedOld,
            },
            reason,
          }
        );
      }

      const channel = await ctx.client.getChannel(channelId);
      const guildId = 'guild_id' in channel ? channel.guild_id : undefined;
      if (!guildId) {
        return fail(`Channel ${channelId} is not a guild channel — cannot resolve the guild for the sovereignty guard.`);
      }
      await ctx.control.assertControl(guildId);

      if (toDelete.length === 1) {
        await ctx.client.deleteMessage(channelId, toDelete[0]!, { reason });
      } else {
        await ctx.client.bulkDeleteMessages(channelId, toDelete, { reason });
      }
      return ok(
        `✅ Purged ${toDelete.length} message(s) in <#${channelId}>: ${toDelete.map((id) => `\`${id}\``).join(', ')} (skipped ${skippedPinned} pinned, ${skippedOld} older than 14 days).`,
        {
          channel_id: channelId,
          purged_count: toDelete.length,
          purged_message_ids: toDelete,
          skipped_pinned: skippedPinned,
          skipped_old: skippedOld,
          reason,
        }
      );
    },
  },
];