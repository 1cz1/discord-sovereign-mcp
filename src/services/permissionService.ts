import { PermissionFlagsBits } from 'discord-api-types/v10';
import type { APIChannel, APIGuild, APIGuildMember, APIRole, APIOverwrite } from 'discord-api-types/payloads/v10';
import { OverwriteType } from 'discord-api-types/v10';
import type { DiscordClient } from '../client/discordClient.js';
import { ROLE_COLOR_PALETTE } from '../constants.js';

const BITS = PermissionFlagsBits as Record<string, bigint>;

export const ALL_PERMISSION_NAMES: string[] = Object.keys(BITS);
export const ALL_PERMISSIONS: bigint = Object.values(BITS).reduce((acc, b) => acc | b, 0n);
export const ADMINISTRATOR: bigint = BITS['Administrator']!;

const NAME_TO_BIT: Map<string, bigint> = new Map(
  ALL_PERMISSION_NAMES.map((name) => [name.toLowerCase(), BITS[name]!])
);

const BIT_TO_NAME: { bit: bigint; name: string }[] = ALL_PERMISSION_NAMES.map((name) => ({
  bit: BITS[name]!,
  name,
})).sort((a, b) => (a.bit < b.bit ? -1 : 1));

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** Converts permission names (case-insensitive) to a bitfield. Throws on unknown names. */
export function permissionNamesToBits(names: string[]): bigint {
  let bits = 0n;
  const unknown: string[] = [];
  for (const raw of names) {
    const bit = NAME_TO_BIT.get(raw.trim().toLowerCase());
    if (bit === undefined) {
      unknown.push(raw);
    } else {
      bits |= bit;
    }
  }
  if (unknown.length > 0) {
    throw new PermissionError(
      `Unknown permission(s): ${unknown.join(', ')}. Valid names: ${ALL_PERMISSION_NAMES.join(', ')}`
    );
  }
  return bits;
}

/** Converts a bitfield to permission names, in Discord bit order. */
export function bitsToPermissionNames(bits: bigint): string[] {
  const names: string[] = [];
  for (const { bit, name } of BIT_TO_NAME) {
    if ((bits & bit) !== 0n) names.push(name);
  }
  return names;
}

export function parseBitfield(input: string | number | bigint): bigint {
  if (typeof input === 'bigint') return input;
  if (typeof input === 'number') return BigInt(input);
  const trimmed = input.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(trimmed)) return BigInt(trimmed);
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  const bits = permissionNamesToBits(trimmed.split(/\s*,\s*|\s+/));
  return bits;
}

export function isAdministrator(bits: bigint): boolean {
  return (bits & ADMINISTRATOR) !== 0n;
}

export function parseColor(input: string): number {
  const trimmed = input.trim();
  const named = trimmed.toLowerCase();
  if (named === 'default' || named === 'none' || named === '') return 0;
  const palette = ROLE_COLOR_PALETTE[named];
  if (palette !== undefined) return palette;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return parseInt(trimmed.slice(1), 16);
  if (/^0x[0-9a-f]{1,6}$/i.test(trimmed)) return parseInt(trimmed.slice(2), 16);
  if (/^\d{1,8}$/.test(trimmed)) return Number(BigInt(trimmed) & 0xffffffn);
  throw new PermissionError(
    `Invalid color '${input}'. Use #RRGGBB (e.g. #e74c3c), 0xRRGGBB, a decimal integer, or one of the named palette colors.`
  );
}

export function formatColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export interface EffectivePermissions {
  bitfield: string;
  names: string[];
  administrator: boolean;
  source: string;
}

export interface PermissionPreload {
  guild: APIGuild;
  member: APIGuildMember | null;
  roles: APIRole[];
}

/**
 * Computes the effective permissions of a member in a guild.
 * Applies the owner bypass, the Administrator shortcut, guild-level
 * @everyone + role permissions, then channel overwrites in Discord's
 * documented precedence order (@everyone -> roles -> member).
 * Pass `preloaded` (guild, member, roles fetched once) when computing
 * permissions for many channels of the same guild to avoid N+1 fetches.
 */
export async function calculateMemberPermissions(
  client: DiscordClient,
  guildId: string,
  userId: string,
  channel?: APIChannel,
  preloaded?: PermissionPreload
): Promise<EffectivePermissions> {
  const guild = preloaded?.guild ?? (await client.getGuild(guildId));
  if (guild.owner_id === userId) {
    return {
      bitfield: ALL_PERMISSIONS.toString(),
      names: ALL_PERMISSION_NAMES,
      administrator: true,
      source: 'guild owner (full access)',
    };
  }

  const member =
    preloaded !== undefined
      ? preloaded.member
      : await client.getMember(guildId, userId).catch(() => null);
  const roles = preloaded?.roles ?? (await client.getRoles(guildId));
  if (!member) {
    throw new PermissionError(`User ${userId} is not a member of guild ${guildId}.`);
  }

  const everyone = roles.find((r) => r.id === guildId);
  const memberRoles: APIRole[] = roles
    .filter((r) => member.roles.includes(r.id))
    .sort((a, b) => a.position - b.position);

  let bits = BigInt(everyone?.permissions ?? '0');
  for (const role of memberRoles) bits |= BigInt(role.permissions);
  let source = '@everyone' + (memberRoles.length > 0 ? ` + ${memberRoles.map((r) => `@${r.name}`).join(', ')}` : '');

  if (isAdministrator(bits)) {
    return { bitfield: ALL_PERMISSIONS.toString(), names: ALL_PERMISSION_NAMES, administrator: true, source };
  }

  const overwrites: APIOverwrite[] =
    channel && 'permission_overwrites' in channel ? (channel.permission_overwrites ?? []) : [];
  if (channel && 'permission_overwrites' in channel) {
    const apply = (o: APIOverwrite): void => {
      bits = (bits & ~BigInt(o.deny)) | BigInt(o.allow);
    };
    const everyoneOverwrite = overwrites.find((o) => o.type === OverwriteType.Role && o.id === guildId);
    if (everyoneOverwrite) {
      apply(everyoneOverwrite);
      source += ' -> channel @everyone overwrite';
    }
    for (const role of memberRoles) {
      const o = overwrites.find((ow) => ow.type === OverwriteType.Role && ow.id === role.id);
      if (o) {
        apply(o);
        source += ` -> @${role.name} overwrite`;
      }
    }
    const memberOverwrite = overwrites.find((o) => o.type === OverwriteType.Member && o.id === userId);
    if (memberOverwrite) {
      apply(memberOverwrite);
      source += ' -> member overwrite';
    }
  }

  const names = bitsToPermissionNames(bits);
  return {
    bitfield: bits.toString(),
    names,
    administrator: false,
    source,
  };
}

export function buildOverwriteBody(allow: string[] | undefined, deny: string[] | undefined): { allow: string; deny: string } {
  return {
    allow: (allow ? permissionNamesToBits(allow) : 0n).toString(),
    deny: (deny ? permissionNamesToBits(deny) : 0n).toString(),
  };
}