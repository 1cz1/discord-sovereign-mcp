import type { APIBan, APIChannel, APIGuild, APIGuildMember, APIMessage, APIRole } from 'discord-api-types/payloads/v10';
import { ChannelType } from 'discord-api-types/v10';
import { CHARACTER_LIMIT, DEFAULT_LIMIT, MAX_LIMIT, GUILD_CHANNEL_TYPE_LABELS } from '../constants.js';

export function truncate(text: string, max = CHARACTER_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export interface Page<T> {
  items: T[];
  page: {
    count: number;
    limit: number;
    offset: number;
    total?: number;
    has_more: boolean;
    next_offset: number;
  };
}

export function normalizePagination(input: { limit?: number; offset?: number }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(input.offset ?? 0, 0);
  return { limit, offset };
}

export function paginate<T>(items: T[], input: { limit?: number; offset?: number }, total?: number): Page<T> {
  const { limit, offset } = normalizePagination(input);
  const slice = items.slice(offset, offset + limit);
  return {
    items: slice,
    page: {
      count: slice.length,
      limit,
      offset,
      total,
      has_more: total !== undefined ? offset + slice.length < total : offset + slice.length < items.length,
      next_offset: offset + slice.length,
    },
  };
}

export function fmtPermissions(names: string[]): string {
  if (names.length === 0) return 'none';
  return names.join(', ');
}

export function fmtGuild(g: APIGuild): string {
  const lines = [
    `**${g.name}** \`${g.id}\``,
    `Owner: <@${g.owner_id}> | Members: ${g.approximate_member_count ?? 'n/a'} | Tier: ${g.premium_tier}`,
    `Verification: ${g.verification_level} | Features: ${(g.features ?? []).slice(0, 8).join(', ') || 'none'}`,
  ];
  return lines.join('\n');
}

export function fmtRole(r: APIRole): string {
  const parts = [`@${r.name}`, `\`${r.id}\``, `pos ${r.position}`, `#${r.color.toString(16).padStart(6, '0')}`];
  if (r.hoist) parts.push('hoisted');
  if (r.mentionable) parts.push('mentionable');
  if (r.managed) parts.push('managed');
  if (r.tags?.bot_id) parts.push(`bot: <@${r.tags.bot_id}>`);
  return parts.join(' · ');
}

export function fmtChannel(c: APIChannel): string {
  const type = GUILD_CHANNEL_TYPE_LABELS[c.type] ?? `type_${c.type}`;
  const isGuild = c.type !== ChannelType.DM && c.type !== ChannelType.GroupDM;
  const parts = [`#${isGuild ? (c.name ?? '(unnamed)') : '(DM)'}`, `\`${c.id}\``, type];
  if (isGuild) {
    if ('topic' in c && c.topic) parts.push(`topic: ${truncate(c.topic, 80)}`);
    if ('nsfw' in c && c.nsfw) parts.push('nsfw');
    if ('rate_limit_per_user' in c && typeof c.rate_limit_per_user === 'number' && c.rate_limit_per_user > 0)
      parts.push(`slowmode ${c.rate_limit_per_user}s`);
    if ('user_limit' in c && typeof c.user_limit === 'number' && c.user_limit > 0) parts.push(`limit ${c.user_limit}`);
    if ('bitrate' in c && typeof c.bitrate === 'number') parts.push(`bitrate ${Math.round(c.bitrate / 1000)}kbps`);
    const parent = c.parent_id ?? (c.type === ChannelType.GuildCategory ? '(category)' : null);
    if (parent) parts.push(`parent \`${parent}\``);
  }
  return parts.join(' · ');
}

export function fmtMember(m: APIGuildMember): string {
  const user = m.user;
  const name = user ? `${user.global_name ?? user.username}` : 'unknown user';
  const nick = m.nick ? ` (${m.nick})` : '';
  const roles = m.roles.length > 0 ? ` | roles: ${m.roles.length}` : '';
  const joined = m.joined_at ? ` | joined ${new Date(m.joined_at).toISOString().slice(0, 10)}` : '';
  const timeout = m.communication_disabled_until
    ? ` | timeout until ${new Date(m.communication_disabled_until).toISOString().slice(0, 16)}`
    : '';
  return `<@${user?.id ?? '?'}> **${name}${nick}** \`${user?.id ?? '?'}\`${roles}${joined}${timeout}`;
}

export function fmtBan(ban: APIBan): string {
  const user = ban.user;
  const reason = ban.reason ? ` | reason: ${truncate(ban.reason, 120)}` : '';
  return `<@${user.id}> **${user.global_name ?? user.username}** \`${user.id}\`${reason}`;
}

export function fmtMessage(msg: APIMessage): string {
  const author = msg.author ? `${msg.author.global_name ?? msg.author.username}` : 'unknown';
  const content = msg.content ? `\n${truncate(msg.content, 1000)}` : '';
  const attachments =
    msg.attachments && msg.attachments.length > 0 ? `\n[${msg.attachments.length} attachment(s)]` : '';
  const embeds = msg.embeds && msg.embeds.length > 0 ? `\n[${msg.embeds.length} embed(s)]` : '';
  const stamp = new Date(msg.timestamp).toISOString().replace('T', ' ').slice(0, 19);
  return `**${author}** (${stamp}) \`${msg.id}\`${content}${attachments}${embeds}`;
}

export function fmtBitfield(bits: bigint): string {
  return bits.toString();
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}