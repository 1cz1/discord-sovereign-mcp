import type { APIRole } from 'discord-api-types/payloads/v10';
import type { DiscordClient } from '../client/discordClient.js';
import { describeDiscordError } from '../client/errors.js';

export interface LadderEntry {
  id: string;
  name: string;
  position: number;
  isClient: boolean;
  isEveryone: boolean;
  permissions: string;
  memberCount: number;
}

export interface ControlVerdict {
  guildId: string;
  controlled: boolean;
  mode: 'owner' | 'role';
  roleCount: number;
  topRole: { id: string; name: string; position: number } | null;
  clientRole: { id: string; name: string; position: number } | null;
  ladder: LadderEntry[];
  remediation: string | null;
  note: string | null;
}

export class ControlError extends Error {
  constructor(public readonly guildId: string, public readonly verdict: ControlVerdict) {
    super(buildRemediation(verdict));
    this.name = 'ControlError';
  }
}

function buildRemediation(v: ControlVerdict): string {
  const parts = [
    `Control denied for guild ${v.guildId}: the client does not hold the #1 (highest) role.`,
  ];
  if (v.topRole) {
    parts.push(
      `Top role is "@${v.topRole.name}" (position ${v.topRole.position}), while the client's highest role is ${
        v.clientRole ? `"@${v.clientRole.name}" (position ${v.clientRole.position})` : 'none'
      }.`
    );
  }
  parts.push('Run discord_assert_control to see the full ladder, then discord_elevate_control to move the client role to the top (or drag it to the top in Server Settings > Roles).');
  return parts.join(' ');
}

function sortLadder(roles: APIRole[]): APIRole[] {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return b.position - a.position;
    return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
  });
}

/**
 * The Sovereignty Guard. Every mutating operation must pass assertControl():
 * the client only acts when it is the guild owner (user mode) or holds the
 * #1 (highest) role in the role hierarchy (bot mode). Role POSITION, not
 * permission flags, decides hierarchy on Discord — this is the single most
 * common cause of "Missing Permissions" failures in LLM-driven admin bots.
 */
export class ControlService {
  constructor(private readonly client: DiscordClient) {}

  async getVerdict(guildId: string): Promise<ControlVerdict> {
    const guild = await this.client.getGuild(guildId);
    const roles = sortLadder(await this.client.getRoles(guildId));
    const me = this.client.me;

    const isOwner = guild.owner_id === me.id;

    let clientRole: APIRole | null = null;
    if (!isOwner) {
      const member = await this.client.getMember(guildId, me.id).catch(() => null);
      if (member) {
        const clientRoles = roles.filter((r) => member.roles.includes(r.id));
        clientRole = clientRoles.length > 0 ? clientRoles[0]! : null;
      }
    }

    const topRole = roles.length > 0 ? roles[0]! : null;
    const roleCount = roles.length;

    const controlled = isOwner || (clientRole !== null && topRole !== null && clientRole.position === topRole.position && roleCount > 1);

    const ladder: LadderEntry[] = roles.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      isClient: clientRole?.id === r.id,
      isEveryone: r.id === guildId,
      permissions: r.permissions.toString(),
      memberCount: 0,
    }));

    const verdict: ControlVerdict = {
      guildId,
      controlled,
      mode: isOwner ? 'owner' : 'role',
      roleCount,
      topRole: topRole
        ? { id: topRole.id, name: topRole.name, position: topRole.position }
        : null,
      clientRole: clientRole
        ? { id: clientRole.id, name: clientRole.name, position: clientRole.position }
        : null,
      ladder,
      remediation: controlled ? null : buildRemediation({
        guildId,
        controlled: false,
        mode: 'role',
        roleCount,
        topRole: topRole ? { id: topRole.id, name: topRole.name, position: topRole.position } : null,
        clientRole: clientRole ? { id: clientRole.id, name: clientRole.name, position: clientRole.position } : null,
        ladder: [],
        remediation: null,
        note: null,
      }),
      note: isOwner
        ? 'The client owns this guild (user token) — full control granted.'
        : controlled
          ? `The client's highest role "@${clientRole!.name}" is the #1 role.`
          : 'The client does not hold the #1 role. Destructive and administrative operations are blocked.',
    };

    return verdict;
  }

  /** Throws ControlError when the client does not hold the #1 role (or ownership). */
  async assertControl(guildId: string): Promise<ControlVerdict> {
    const verdict = await this.getVerdict(guildId);
    if (!verdict.controlled) {
      throw new ControlError(guildId, verdict);
    }
    return verdict;
  }

  /**
   * Reorders the client's role to the top of the hierarchy.
   * Legally only possible when the client already outranks every role it is
   * moving above — the API enforces this. Never fails silently.
   */
  async elevateControl(guildId: string): Promise<ControlVerdict> {
    const verdict = await this.getVerdict(guildId);
    if (verdict.mode === 'owner') {
      return verdict;
    }
    if (verdict.controlled) {
      return verdict;
    }
    if (!verdict.clientRole) {
      throw new ControlError(guildId, verdict);
    }
    const target = verdict.topRole;
    if (!target) {
      throw new ControlError(guildId, verdict);
    }
    try {
      await this.client.reorderRoles(guildId, [{ id: verdict.clientRole.id, position: target.position }]);
    } catch (err) {
      const info = describeDiscordError(err);
      throw new Error(
        `Could not elevate: ${info.message} — the client role may not outrank the roles above it. ` +
          'Ask a human to drag the role to the top in Server Settings > Roles, or grant the client a higher position manually.'
      );
    }
    return this.getVerdict(guildId);
  }
}