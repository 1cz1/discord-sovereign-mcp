import { z } from 'zod';
import { ChannelType, OverwriteType } from 'discord-api-types/v10';
import type { APIChannel } from 'discord-api-types/payloads/v10';
import type {
  RESTPatchAPIChannelJSONBody,
  RESTPostAPIGuildChannelJSONBody,
  RESTPostAPIChannelThreadsJSONBody,
  RESTPutAPIChannelPermissionJSONBody,
} from 'discord-api-types/rest/v10';
import type { Identity } from '../client/discordClient.js';
import { describeDiscordError } from '../client/errors.js';
import { ok, fail } from './registry.js';
import type { MCPResult, RegisteredTool, ToolContext, ToolInput } from './registry.js';
import {
  channelIdSchema,
  dryRunSchema,
  guildIdSchema,
  limitSchema,
  messageIdSchema,
  offsetSchema,
  permissionsSchema,
  reasonSchema,
  userIdSchema,
} from './sharedSchemas.js';
import { buildOverwriteBody, calculateMemberPermissions, bitsToPermissionNames } from '../services/permissionService.js';
import { fmtChannel, fmtPermissions, jsonSafe, paginate, resolveReason, truncate } from '../utils/format.js';
import { CHANNEL_TYPE_LABELS, GUILD_CHANNEL_TYPE_LABELS } from '../constants.js';

function typeLabel(t: number): string {
  return (
    GUILD_CHANNEL_TYPE_LABELS[t] ??
    (t === ChannelType.AnnouncementThread
      ? 'announcement_thread'
      : t === ChannelType.PublicThread
        ? 'public_thread'
        : t === ChannelType.PrivateThread
          ? 'private_thread'
          : `type_${t}`)
  );
}

function isDryRun(p: { dry_run?: unknown }): boolean {
  return p.dry_run !== false;
}

/** Guild channels (APIChannel minus DM variants: these carry guild_id and parent_id). */
type GuildChannel = Extract<APIChannel, { guild_id?: string }>;

function isGuildChannel(c: APIChannel): c is GuildChannel {
  return 'guild_id' in c && typeof c.guild_id === 'string';
}

/** Fetches a channel and ensures it belongs to a guild (needed for the Sovereignty Guard). */
async function requireGuildChannel(ctx: ToolContext, channelId: string): Promise<GuildChannel & { guild_id: string }> {
  const channel = await ctx.client.getChannel(channelId);
  if (!isGuildChannel(channel)) {
    throw new Error(`Channel ${channelId} is not a guild channel; this operation only applies to server channels.`);
  }
  return channel as GuildChannel & { guild_id: string };
}

function dryRunResult(description: string, wouldExecute: Record<string, unknown>): MCPResult {
  return ok(
    `🔍 DRY RUN: no changes made. ${description}\n\`\`\`json\n${JSON.stringify(wouldExecute, null, 2)}\n\`\`\``,
    { dry_run: true, would_execute: wouldExecute }
  );
}

// ── discord_list_channels ────────────────────────────────────────────────

interface ListChannelsInput {
  guild_id: string;
  parent_id?: string;
  include_threads?: boolean;
  limit?: number;
  offset?: number;
}

const listChannelsSchema = z
  .object({
    guild_id: guildIdSchema,
    parent_id: channelIdSchema
      .optional()
      .describe('Only return channels whose parent is this category (or, for threads, whose parent is this channel).'),
    include_threads: z
      .boolean()
      .default(false)
      .describe('Also list currently active threads (from GET /guilds/{guild.id}/threads/active), marked separately.'),
    limit: limitSchema,
    offset: offsetSchema,
  })
  .strict();

const listChannels: RegisteredTool = {
  name: 'discord_list_channels',
  title: 'List guild channels',
  description:
    'Lists all channels in a guild, optionally filtered by parent category, and optionally including active threads. ' +
    'Channels are grouped by their parent category in the text output; categories show their child count. ' +
    'Use parent_id to inspect a single category. Paginate with limit/offset (next_offset is returned when more pages exist).',
  inputSchema: listChannelsSchema,
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as ListChannelsInput;
    const channels = (await ctx.client.getChannels(p.guild_id)) as GuildChannel[];
    const threads = p.include_threads === true
      ? ((await ctx.client.getActiveThreads(p.guild_id)) as GuildChannel[])
      : [];

    const filteredChannels = p.parent_id ? channels.filter((c) => c.parent_id === p.parent_id) : channels;
    const filteredThreads = p.parent_id ? threads.filter((t) => t.parent_id === p.parent_id) : threads;

    const childCounts = new Map<string, number>();
    for (const c of channels) {
      if (c.parent_id) childCounts.set(c.parent_id, (childCounts.get(c.parent_id) ?? 0) + 1);
    }
    const categoryNames = new Map<string, string>(
      channels
        .filter((c) => c.type === ChannelType.GuildCategory)
        .map((c) => [c.id, c.name ?? '(unnamed)'])
    );

    type Entry = { kind: 'channel' | 'thread'; channel: GuildChannel };
    const entries: Entry[] = [
      ...filteredChannels.map((c): Entry => ({ kind: 'channel', channel: c })),
      ...filteredThreads.map((t): Entry => ({ kind: 'thread', channel: t })),
    ];
    const page = paginate<Entry>(entries, { limit: p.limit, offset: p.offset }, entries.length);

    const lines: string[] = [`Channels in guild \`${p.guild_id}\` (${entries.length} total):`];
    for (const entry of page.items) {
      const ch = entry.channel;
      if (entry.kind === 'channel' && ch.type === ChannelType.GuildCategory) {
        lines.push(
          `\n**📁 ${ch.name ?? '(unnamed)'}** \`${ch.id}\`: category · ${childCounts.get(ch.id) ?? 0} child channel(s)`
        );
      } else if (entry.kind === 'thread') {
        lines.push(`  🧵 ${fmtChannel(ch)} · thread in \`${ch.parent_id ?? '?'}\``);
      } else {
        const parent = ch.parent_id ? categoryNames.get(ch.parent_id) : null;
        lines.push(`${parent ? '  ' : '-'} ${fmtChannel(ch)}${parent ? ` · in 📁 ${parent}` : ''}`);
      }
    }
    if (page.page.has_more) {
      lines.push(`\nMore results available: use offset=${page.page.next_offset} to fetch the next page.`);
    }

    const channelEntry = (ch: GuildChannel, thread: boolean) => ({
      id: ch.id,
      type: typeLabel(ch.type),
      name: ch.name ?? null,
      parent_id: ch.parent_id ?? null,
      position: 'position' in ch ? (ch.position ?? null) : null,
      topic: 'topic' in ch ? (ch.topic ?? null) : null,
      nsfw: 'nsfw' in ch ? (ch.nsfw ?? false) : false,
      slowmode: 'rate_limit_per_user' in ch ? (ch.rate_limit_per_user ?? 0) : 0,
      user_limit: 'user_limit' in ch ? (ch.user_limit ?? 0) : 0,
      bitrate: 'bitrate' in ch ? (ch.bitrate ?? 0) : 0,
      ...(thread ? { thread: true } : {}),
      ...(ch.type === ChannelType.GuildCategory ? { thread_count: childCounts.get(ch.id) ?? 0 } : {}),
    });

    return ok(lines.join('\n'), {
      page: page.page,
      channels: page.items.filter((e) => e.kind === 'channel').map((e) => channelEntry(e.channel, false)),
      threads: page.items.filter((e) => e.kind === 'thread').map((e) => channelEntry(e.channel, true)),
    });
  },
};

// ── discord_get_channel ──────────────────────────────────────────────────

interface GetChannelInput {
  channel_id: string;
}

const getChannelSchema = z.object({ channel_id: channelIdSchema }).strict();

const getChannel: RegisteredTool = {
  name: 'discord_get_channel',
  title: 'Get channel details',
  description:
    'Fetches a single channel by ID (text, voice, category, thread, forum, ...) and returns its full details ' +
    'including topic, position, parent category, overwrites, and type-specific fields.',
  inputSchema: getChannelSchema,
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as GetChannelInput;
    const channel = await ctx.client.getChannel(p.channel_id);
    const guildChannel = isGuildChannel(channel) ? channel : null;
    const extra: string[] = [];
    if ('topic' in channel && channel.topic) extra.push(`Topic: ${truncate(channel.topic, 200)}`);
    if ('position' in channel && typeof channel.position === 'number') extra.push(`Position: ${channel.position}`);
    if (guildChannel?.parent_id) extra.push(`Parent category: \`${guildChannel.parent_id}\``);
    if ('nsfw' in channel && channel.nsfw) extra.push('NSFW');
    if ('rate_limit_per_user' in channel && typeof channel.rate_limit_per_user === 'number' && channel.rate_limit_per_user > 0)
      extra.push(`Slowmode: ${channel.rate_limit_per_user}s`);
    if ('user_limit' in channel && typeof channel.user_limit === 'number' && channel.user_limit > 0)
      extra.push(`User limit: ${channel.user_limit}`);
    if ('bitrate' in channel && typeof channel.bitrate === 'number')
      extra.push(`Bitrate: ${Math.round(channel.bitrate / 1000)}kbps`);
    if ('permission_overwrites' in channel)
      extra.push(`Permission overwrites: ${(channel.permission_overwrites ?? []).length}`);
    if ('message_count' in channel && typeof channel.message_count === 'number') extra.push(`Messages: ${channel.message_count}`);
    if ('thread_metadata' in channel && channel.thread_metadata) {
      extra.push(
        `Thread: archived=${channel.thread_metadata.archived}, auto-archive=${channel.thread_metadata.auto_archive_duration}min, locked=${channel.thread_metadata.locked}`
      );
    }
    const text = `${fmtChannel(channel)}${extra.length > 0 ? `\n${extra.join('\n')}` : ''}`;
    return ok(text, jsonSafe(channel) as Record<string, unknown>);
  },
};

// ── discord_create_channel ───────────────────────────────────────────────

interface CreateChannelInput {
  guild_id: string;
  name: string;
  type?: 'text' | 'voice' | 'category' | 'announcement' | 'forum' | 'stage';
  topic?: string;
  position?: number;
  parent_id?: string;
  nsfw?: boolean;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  reason?: string;
  dry_run?: boolean;
}

const createChannelSchema = z
  .object({
    guild_id: guildIdSchema,
    name: z.string().min(1).max(100).describe('Channel name (1-100 characters; emoji allowed).'),
    type: z
      .enum(['text', 'voice', 'category', 'announcement', 'forum', 'stage'])
      .default('text')
      .describe('Channel type. text (default), voice, category, announcement (news), forum, or stage.'),
    topic: z
      .string()
      .max(1024)
      .optional()
      .describe('Channel topic (0-1024 characters; text, announcement, forum, media only).'),
    position: z.number().int().optional().describe('Position in the channel list (lower = higher).'),
    parent_id: channelIdSchema.optional().describe('ID of the parent category to place this channel under.'),
    nsfw: z.boolean().optional().describe('Mark the channel as age-restricted (NSFW).'),
    bitrate: z
      .number()
      .int()
      .min(8000)
      .max(384000)
      .optional()
      .describe('Voice bitrate in bits per second (8000-384000; 96000 default, higher requires boost).'),
    user_limit: z
      .number()
      .int()
      .min(0)
      .max(99)
      .optional()
      .describe('Voice user limit (0 = unlimited, 1-99 = limit).'),
    rate_limit_per_user: z
      .number()
      .int()
      .min(0)
      .max(21600)
      .optional()
      .describe('Slowmode: seconds a user must wait between messages (0-21600).'),
    reason: reasonSchema,
    dry_run: dryRunSchema,
  })
  .strict();

const createChannel: RegisteredTool = {
  name: 'discord_create_channel',
  title: 'Create channel',
  description:
    'Creates a channel in a guild. Defaults to a text channel; pass type=voice|category|announcement|forum|stage for others. ' +
    'Use parent_id to nest under a category. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. ' +
    'Set dry_run=false to actually create the channel.',
  inputSchema: createChannelSchema,
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as CreateChannelInput;
    const typeInt = CHANNEL_TYPE_LABELS[p.type ?? 'text']!;
    type GuildChannelTypeValue = Exclude<ChannelType, ChannelType.DM | ChannelType.GroupDM | ChannelType.GuildDirectory>;
    const body: RESTPostAPIGuildChannelJSONBody = {
      name: p.name,
      type: typeInt as GuildChannelTypeValue,
      ...(p.topic !== undefined ? { topic: p.topic } : {}),
      ...(p.position !== undefined ? { position: p.position } : {}),
      ...(p.parent_id !== undefined ? { parent_id: p.parent_id } : {}),
      ...(p.nsfw !== undefined ? { nsfw: p.nsfw } : {}),
      ...(p.bitrate !== undefined ? { bitrate: p.bitrate } : {}),
      ...(p.user_limit !== undefined ? { user_limit: p.user_limit } : {}),
      ...(p.rate_limit_per_user !== undefined ? { rate_limit_per_user: p.rate_limit_per_user } : {}),
    };
    const reason = resolveReason(p.reason);
    if (isDryRun(p)) {
      return dryRunResult(`Would create a ${p.type ?? 'text'} channel named "${p.name}".`, {
        endpoint: 'POST /guilds/{guild_id}/channels',
        method: 'POST',
        guild_id: p.guild_id,
        body,
        reason,
      });
    }
    await ctx.control.assertControl(p.guild_id);
    const channel = await ctx.client.createChannel(p.guild_id, body, { reason });
    return ok(
      `✅ Created ${typeLabel(channel.type)} channel **#${channel.name ?? '(unnamed)'}** \`${channel.id}\``,
      { id: channel.id, type: typeLabel(channel.type), name: channel.name ?? null }
    );
  },
};

// ── discord_update_channel ───────────────────────────────────────────────

interface UpdateChannelInput {
  channel_id: string;
  name?: string;
  topic?: string;
  position?: number;
  parent_id?: string;
  nsfw?: boolean;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  reason?: string;
  dry_run?: boolean;
}

const updateChannelSchema = z
  .object({
    channel_id: channelIdSchema,
    name: z.string().min(1).max(100).optional().describe('New channel name (1-100 characters).'),
    topic: z
      .string()
      .max(1024)
      .optional()
      .describe('New topic. Pass an empty string ("") to clear the topic.'),
    position: z.number().int().optional().describe('New position in the channel list (lower = higher).'),
    parent_id: channelIdSchema.optional().describe('ID of the new parent category (move the channel).'),
    nsfw: z.boolean().optional().describe('Mark/unmark the channel as age-restricted (NSFW).'),
    bitrate: z.number().int().min(8000).max(384000).optional().describe('New voice bitrate in bits per second.'),
    user_limit: z.number().int().min(0).max(99).optional().describe('New voice user limit (0 = unlimited).'),
    rate_limit_per_user: z
      .number()
      .int()
      .min(0)
      .max(21600)
      .optional()
      .describe('New slowmode in seconds (0 = off).'),
    reason: reasonSchema,
    dry_run: dryRunSchema,
  })
  .strict();

const updateChannel: RegisteredTool = {
  name: 'discord_update_channel',
  title: 'Update channel',
  description:
    'Updates one or more properties of a guild channel (name, topic, position, parent category, nsfw, bitrate, user limit, slowmode). ' +
    'Pass topic: "" to clear the topic. Only the fields you provide are changed. ' +
    'The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to apply.',
  inputSchema: updateChannelSchema,
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as UpdateChannelInput;
    const channel = await requireGuildChannel(ctx, p.channel_id);
    const body: RESTPatchAPIChannelJSONBody = {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.topic !== undefined ? { topic: p.topic } : {}),
      ...(p.position !== undefined ? { position: p.position } : {}),
      ...(p.parent_id !== undefined ? { parent_id: p.parent_id } : {}),
      ...(p.nsfw !== undefined ? { nsfw: p.nsfw } : {}),
      ...(p.bitrate !== undefined ? { bitrate: p.bitrate } : {}),
      ...(p.user_limit !== undefined ? { user_limit: p.user_limit } : {}),
      ...(p.rate_limit_per_user !== undefined ? { rate_limit_per_user: p.rate_limit_per_user } : {}),
    };
    const reason = resolveReason(p.reason);
    if (isDryRun(p)) {
      return dryRunResult(`Would update channel #${channel.name ?? channel.id} with the following fields.`, {
        endpoint: 'PATCH /channels/{channel_id}',
        method: 'PATCH',
        channel_id: p.channel_id,
        body,
        reason,
      });
    }
    await ctx.control.assertControl(channel.guild_id);
    const updated = await ctx.client.updateChannel(p.channel_id, body, { reason });
    const updatedGuild = isGuildChannel(updated) ? updated : null;
    return ok(
      `✅ Updated channel **#${updated.name ?? '(unnamed)'}** \`${updated.id}\``,
      {
        id: updated.id,
        type: typeLabel(updated.type),
        name: updated.name ?? null,
        topic: 'topic' in updated ? (updated.topic ?? null) : null,
        position: 'position' in updated ? (updated.position ?? null) : null,
        parent_id: updatedGuild?.parent_id ?? null,
        nsfw: 'nsfw' in updated ? (updated.nsfw ?? false) : false,
        bitrate: 'bitrate' in updated ? (updated.bitrate ?? null) : null,
        user_limit: 'user_limit' in updated ? (updated.user_limit ?? null) : null,
        rate_limit_per_user: 'rate_limit_per_user' in updated ? (updated.rate_limit_per_user ?? null) : null,
      }
    );
  },
};

// ── discord_delete_channel ───────────────────────────────────────────────

interface DeleteChannelInput {
  channel_id: string;
  reason?: string;
  dry_run?: boolean;
}

const deleteChannelSchema = z
  .object({
    channel_id: channelIdSchema,
    reason: reasonSchema,
    dry_run: dryRunSchema,
  })
  .strict();

const deleteChannel: RegisteredTool = {
  name: 'discord_delete_channel',
  title: 'Delete channel',
  description:
    'Deletes a guild channel. ⚠️ WARNING: deleting a channel also deletes ALL threads inside it and permanently destroys its ' +
    'message history: there is no undo. The Sovereignty Guard applies: the client must own the guild or hold the #1 role. ' +
    'Set dry_run=false to actually delete the channel.',
  inputSchema: deleteChannelSchema,
  annotations: { destructiveHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as DeleteChannelInput;
    const channel = await requireGuildChannel(ctx, p.channel_id);
    const reason = resolveReason(p.reason);
    if (isDryRun(p)) {
      return dryRunResult(
        `Would permanently delete channel #${channel.name ?? channel.id}: including its threads and message history.`,
        {
          endpoint: 'DELETE /channels/{channel_id}',
          method: 'DELETE',
          channel_id: p.channel_id,
          reason,
          warning: 'Destroys the channel, all of its threads, and all message history. Irreversible.',
        }
      );
    }
    await ctx.control.assertControl(channel.guild_id);
    await ctx.client.deleteChannel(p.channel_id, { reason });
    return ok(`✅ Deleted channel **#${channel.name ?? '(unnamed)'}** \`${p.channel_id}\``, {
      deleted_channel_id: p.channel_id,
      name: channel.name ?? null,
      deleted: true,
    });
  },
};

// ── discord_create_thread ────────────────────────────────────────────────

interface CreateThreadInput {
  channel_id: string;
  name: string;
  message_id?: string;
  type?: 'public_thread' | 'private_thread';
  auto_archive_duration?: 60 | 1440 | 4320 | 10080;
  rate_limit_per_user?: number;
  reason?: string;
  dry_run?: boolean;
}

const createThreadSchema = z
  .object({
    channel_id: channelIdSchema,
    name: z.string().min(1).max(100).describe('Thread name (1-100 characters).'),
    message_id: messageIdSchema
      .optional()
      .describe(
        'Optional starter message ID. For forum channels the post starter is required: pass the starter message ID here; it is forwarded to the thread creation payload.'
      ),
    type: z
      .enum(['public_thread', 'private_thread'])
      .default('public_thread')
      .describe('public_thread (default) or private_thread.'),
    auto_archive_duration: z
      .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
      .optional()
      .describe('Minutes of inactivity before auto-archive: 60, 1440 (1 day), 4320 (3 days), or 10080 (1 week).'),
    rate_limit_per_user: z
      .number()
      .int()
      .min(0)
      .max(21600)
      .optional()
      .describe('Slowmode: seconds a user must wait between messages (0-21600).'),
    reason: reasonSchema,
    dry_run: dryRunSchema,
  })
  .strict();

const createThread: RegisteredTool = {
  name: 'discord_create_thread',
  title: 'Create thread',
  description:
    'Creates a public or private thread in a text/announcement/forum channel. Note: for forum channels a message_id ' +
    '(the post starter) is required, and forum posts are created via the threads endpoint with the starter passed through. ' +
    'The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to create.',
  inputSchema: createThreadSchema,
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as CreateThreadInput;
    const channel = await requireGuildChannel(ctx, p.channel_id);
    const typeInt: ChannelType =
      p.type === 'private_thread' ? ChannelType.PrivateThread : ChannelType.PublicThread;
    const baseBody: RESTPostAPIChannelThreadsJSONBody = {
      name: p.name,
      type: typeInt,
      ...(p.auto_archive_duration !== undefined ? { auto_archive_duration: p.auto_archive_duration } : {}),
      ...(p.rate_limit_per_user !== undefined ? { rate_limit_per_user: p.rate_limit_per_user } : {}),
    };
    const body: RESTPostAPIChannelThreadsJSONBody =
      p.message_id !== undefined
        ? ({ ...baseBody, message_id: p.message_id } as unknown as RESTPostAPIChannelThreadsJSONBody)
        : baseBody;
    const reason = resolveReason(p.reason);
    if (isDryRun(p)) {
      return dryRunResult(`Would create a ${p.type ?? 'public_thread'} thread named "${p.name}".`, {
        endpoint: 'POST /channels/{channel_id}/threads',
        method: 'POST',
        channel_id: p.channel_id,
        body,
        reason,
      });
    }
    await ctx.control.assertControl(channel.guild_id);
    const thread = await ctx.client.createThread(p.channel_id, body, { reason });
    return ok(
      `✅ Created ${typeLabel(thread.type)} **#${thread.name ?? '(unnamed)'}** \`${thread.id}\` in <#${p.channel_id}>`,
      { id: thread.id, name: thread.name ?? null, type: typeLabel(thread.type) }
    );
  },
};

// ── discord_set_permission_overwrite ─────────────────────────────────────

interface SetPermissionOverwriteInput {
  channel_id: string;
  target_type: 'role' | 'member';
  target_id: string;
  allow?: string[];
  deny?: string[];
  reason?: string;
  dry_run?: boolean;
}

const setPermissionOverwriteSchema = z
  .object({
    channel_id: channelIdSchema,
    target_type: z
      .enum(['role', 'member'])
      .describe('Whether the overwrite targets a role (0) or a member (1).'),
    target_id: z
      .string()
      .min(1)
      .max(32)
      .describe('Snowflake ID of the role or member the overwrite applies to.'),
    allow: permissionsSchema.describe(
      'Permissions to explicitly ALLOW for this target (e.g. ["ViewChannel", "SendMessages"]).'
    ),
    deny: permissionsSchema.describe(
      'Permissions to explicitly DENY for this target (e.g. ["SendMessages"]).'
    ),
    reason: reasonSchema,
    dry_run: dryRunSchema,
  })
  .strict();

const setPermissionOverwrite: RegisteredTool = {
  name: 'discord_set_permission_overwrite',
  title: 'Set permission overwrite',
  description:
    'Creates or replaces the permission overwrite for a role or member on a channel. Overwrites follow Discord precedence: ' +
    '@everyone -> role -> member. Provide permission names in allow and/or deny (e.g. ManageRoles, ViewChannel, SendMessages). ' +
    'The Sovereignty Guard applies: the client must own the guild or hold the #1 role. Set dry_run=false to apply.',
  inputSchema: setPermissionOverwriteSchema,
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as SetPermissionOverwriteInput;
    if ((p.allow ?? []).length === 0 && (p.deny ?? []).length === 0) {
      return fail('Provide at least one permission in allow or deny: an overwrite with neither is rejected by Discord.');
    }
    const channel = await requireGuildChannel(ctx, p.channel_id);
    const { allow, deny } = buildOverwriteBody(p.allow, p.deny);
    const overwriteType = p.target_type === 'role' ? OverwriteType.Role : OverwriteType.Member;
    const body: RESTPutAPIChannelPermissionJSONBody = { type: overwriteType, allow, deny };
    const reason = resolveReason(p.reason);
    if (isDryRun(p)) {
      return dryRunResult(`Would set a ${p.target_type} overwrite for \`${p.target_id}\` on #${channel.name ?? channel.id}.`, {
        endpoint: 'PUT /channels/{channel_id}/permissions/{overwrite_id}',
        method: 'PUT',
        channel_id: p.channel_id,
        target_type: p.target_type,
        target_id: p.target_id,
        body,
        allow_names: bitsToPermissionNames(BigInt(allow)),
        deny_names: bitsToPermissionNames(BigInt(deny)),
        reason,
      });
    }
    await ctx.control.assertControl(channel.guild_id);
    await ctx.client.setPermissionOverwrite(p.channel_id, p.target_id, body, { reason });
    return ok(
      `✅ Set ${p.target_type} overwrite for \`${p.target_id}\` on **#${channel.name ?? '(unnamed)'}** \`${p.channel_id}\``,
      {
        channel_id: p.channel_id,
        target_id: p.target_id,
        target_type: p.target_type,
        allow: bitsToPermissionNames(BigInt(allow)),
        deny: bitsToPermissionNames(BigInt(deny)),
        allow_bitfield: allow,
        deny_bitfield: deny,
      }
    );
  },
};

// ── discord_delete_permission_overwrite ──────────────────────────────────

interface DeletePermissionOverwriteInput {
  channel_id: string;
  target_id: string;
  reason?: string;
  dry_run?: boolean;
}

const deletePermissionOverwriteSchema = z
  .object({
    channel_id: channelIdSchema,
    target_id: z
      .string()
      .min(1)
      .max(32)
      .describe('Snowflake ID of the role or member whose overwrite should be removed.'),
    reason: reasonSchema,
    dry_run: dryRunSchema,
  })
  .strict();

const deletePermissionOverwrite: RegisteredTool = {
  name: 'discord_delete_permission_overwrite',
  title: 'Delete permission overwrite',
  description:
    'Removes the permission overwrite for a role or member on a channel, restoring the channel to inherited ' +
    '(parent category + role) permissions for that target. The Sovereignty Guard applies: the client must own the guild ' +
    'or hold the #1 role. Set dry_run=false to actually delete the overwrite.',
  inputSchema: deletePermissionOverwriteSchema,
  annotations: { destructiveHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as DeletePermissionOverwriteInput;
    const channel = await requireGuildChannel(ctx, p.channel_id);
    const reason = resolveReason(p.reason);
    if (isDryRun(p)) {
      return dryRunResult(`Would remove the overwrite for \`${p.target_id}\` on #${channel.name ?? channel.id}.`, {
        endpoint: 'DELETE /channels/{channel_id}/permissions/{overwrite_id}',
        method: 'DELETE',
        channel_id: p.channel_id,
        target_id: p.target_id,
        reason,
      });
    }
    await ctx.control.assertControl(channel.guild_id);
    await ctx.client.deletePermissionOverwrite(p.channel_id, p.target_id, { reason });
    return ok(
      `✅ Removed overwrite for \`${p.target_id}\` on **#${channel.name ?? '(unnamed)'}** \`${p.channel_id}\``,
      { channel_id: p.channel_id, target_id: p.target_id, deleted: true }
    );
  },
};

// ── discord_calculate_permissions ────────────────────────────────────────

interface CalculatePermissionsInput {
  guild_id: string;
  user_id: string;
  channel_id?: string;
}

const calculatePermissionsSchema = z
  .object({
    guild_id: guildIdSchema,
    user_id: userIdSchema,
    channel_id: channelIdSchema
      .optional()
      .describe('Optional channel to include channel-level overwrites in the calculation.'),
  })
  .strict();

const calculatePermissions: RegisteredTool = {
  name: 'discord_calculate_permissions',
  title: 'Calculate member permissions',
  description:
    'Read-only. Computes the effective permission set of a member in a guild, following Discord precedence: ' +
    'owner bypass -> Administrator -> @everyone + role permissions -> channel @everyone/role/member overwrites. ' +
    'Pass channel_id to include channel overwrites. Use this before acting to predict what a member can actually do.',
  inputSchema: calculatePermissionsSchema,
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as CalculatePermissionsInput;
    const guild = await ctx.client.getGuild(p.guild_id);
    const channel = p.channel_id ? await ctx.client.getChannel(p.channel_id) : undefined;
    const result = await calculateMemberPermissions(ctx.client, p.guild_id, p.user_id, channel);

    const channelNote = channel ? `\nChannel: #${channel.name ?? '(unnamed)'} \`${channel.id}\`` : '';
    const text =
      `**Permissions for <@${p.user_id}>** in ${guild.name} \`${p.guild_id}\`${channelNote}\n` +
      `Administrator: ${result.administrator ? 'yes' : 'no'}\n` +
      `Bitfield: \`${result.bitfield}\`\n` +
      `Resolution source: ${result.source}\n` +
      `Permissions: ${fmtPermissions(result.names)}`;

    return ok(text, {
      guild_id: p.guild_id,
      user_id: p.user_id,
      channel_id: channel?.id ?? null,
      administrator: result.administrator,
      bitfield: result.bitfield,
      permission_names: result.names,
      source: result.source,
    });
  },
};

// ── discord_audit_permissions ────────────────────────────────────────────

interface AuditPermissionsInput {
  guild_id: string;
  max_channels?: number;
}

const auditPermissionsSchema = z
  .object({
    guild_id: guildIdSchema,
    max_channels: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum number of channels to audit (1-100). Larger guilds are truncated with a note.'),
  })
  .strict();

const auditPermissions: RegisteredTool = {
  name: 'discord_audit_permissions',
  title: 'Audit channel permissions',
  description:
    'Read-only. Audits how the acting client (the bot or OAuth2 user behind this MCP server) is positioned across a guild: ' +
    'for each channel it reports the overwrite count and whether the client holds MANAGE_CHANNELS and MANAGE_ROLES ' +
    '(effective permissions, including channel overwrites). Helps diagnose "Missing Permissions" failures before acting. ' +
    'Channels are capped at max_channels (default 50) with a truncation note. If the acting user is neither the guild ' +
    'owner nor a member, the audit fails with a clear message.',
  inputSchema: auditPermissionsSchema,
  annotations: { readOnlyHint: true },
  handle: async (params: ToolInput, ctx: ToolContext): Promise<MCPResult> => {
    const p = params as unknown as AuditPermissionsInput;
    let me: Identity;
    try {
      me = ctx.client.me;
    } catch (err) {
      return fail(`Client identity unavailable: ${describeDiscordError(err).message}`);
    }

    const guild = await ctx.client.getGuild(p.guild_id);
    const isOwner = guild.owner_id === me.id;
    const member = isOwner ? null : await ctx.client.getMember(p.guild_id, me.id).catch(() => null);
    if (!isOwner && !member) {
      return fail(
        `Cannot audit guild ${p.guild_id}: acting user <@${me.id}> is neither the guild owner nor a member of this guild.`
      );
    }

    const base = await calculateMemberPermissions(ctx.client, p.guild_id, me.id);
    const baseAdministrator = base.administrator;

    const channels = await ctx.client.getChannels(p.guild_id);
    const max = p.max_channels ?? 50;
    const truncated = channels.length > max;
    const slice = truncated ? channels.slice(0, max) : channels;

    const preloaded = { guild, member, roles: await ctx.client.getRoles(p.guild_id) };

    const report: {
      id: string;
      name: string;
      overwrite_count: number;
      client_manage_channels: boolean;
      client_manage_roles: boolean;
      error?: string;
    }[] = [];
    for (const ch of slice) {
      let manageChannels = false;
      let manageRoles = false;
      let error: string | undefined;
      if (baseAdministrator) {
        manageChannels = true;
        manageRoles = true;
      } else {
        try {
          const perms = await calculateMemberPermissions(ctx.client, p.guild_id, me.id, ch, preloaded);
          manageChannels = perms.names.includes('ManageChannels');
          manageRoles = perms.names.includes('ManageRoles');
        } catch (err) {
          error = describeDiscordError(err).message;
        }
      }
      report.push({
        id: ch.id,
        name: ch.name ?? '(unnamed)',
        overwrite_count: 'permission_overwrites' in ch ? (ch.permission_overwrites?.length ?? 0) : 0,
        client_manage_channels: manageChannels,
        client_manage_roles: manageRoles,
        ...(error !== undefined ? { error } : {}),
      });
    }

    const lines = [
      `**Permission audit**: ${guild.name} \`${p.guild_id}\``,
      `Acting as <@${me.id}> · owner: ${isOwner ? 'yes' : 'no'} · guild-level administrator: ${baseAdministrator ? 'yes' : 'no'}`,
      truncated
        ? `Showing the first ${max} of ${channels.length} channels (truncated).`
        : `${channels.length} channel(s) audited.`,
      '',
    ];
    for (const r of report) {
      const mc = r.client_manage_channels ? '✅' : '❌';
      const mr = r.client_manage_roles ? '✅' : '❌';
      const err = r.error ? ` · error: ${r.error}` : '';
      lines.push(
        `#${r.name} \`${r.id}\` · overwrites: ${r.overwrite_count} · MANAGE_CHANNELS ${mc} · MANAGE_ROLES ${mr}${err}`
      );
    }

    return ok(lines.join('\n'), {
      me: { id: me.id, is_owner: isOwner, administrator: baseAdministrator },
      channels: report,
      total: channels.length,
      truncated,
    });
  },
};

export const channelTools: RegisteredTool[] = [
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  createThread,
  setPermissionOverwrite,
  deletePermissionOverwrite,
  calculatePermissions,
  auditPermissions,
];