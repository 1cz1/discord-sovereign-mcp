import { describe, expect, it, vi } from 'vitest';
import type { APIRole, APIGuild, APIGuildMember } from 'discord-api-types/payloads/v10';
import { ControlService, ControlError } from '../src/services/controlService.js';

const GUILD = '1000000000000000000';
const BOT_ID = '2000000000000000000';
const OWNER_ID = '3000000000000000000';

function role(id: string, name: string, position: number): APIRole {
  return {
    id,
    name,
    position,
    color: 0,
    hoist: false,
    icon: null,
    unicode_emoji: null,
    managed: false,
    mentionable: false,
    permissions: '0',
    flags: 0,
    tags: undefined,
  } as unknown as APIRole;
}

function member(roles: string[]): APIGuildMember {
  return {
    user: { id: BOT_ID, username: 'bot', discriminator: '0', avatar: null },
    roles,
    joined_at: new Date().toISOString(),
    deaf: false,
    mute: false,
    flags: 0,
    pending: false,
    premium_since: null,
    nick: null,
    communication_disabled_until: null,
  } as unknown as APIGuildMember;
}

function makeClient(opts: {
  ownerId?: string;
  roles?: APIRole[];
  clientRoles?: string[];
}): any {
  return {
    me: { id: BOT_ID, username: 'bot', bot: true },
    getGuild: vi.fn(async (): Promise<APIGuild> => {
      return { id: GUILD, owner_id: opts.ownerId ?? OWNER_ID } as unknown as APIGuild;
    }),
    getRoles: vi.fn(async (): Promise<APIRole[]> => opts.roles ?? []),
    getMember: vi.fn(async (): Promise<APIGuildMember | null> => {
      return opts.clientRoles ? member(opts.clientRoles) : null;
    }),
    reorderRoles: vi.fn(async () => opts.roles),
  };
}

describe('ControlService.getVerdict', () => {
  it('grants control when the client owns the guild', async () => {
    const service = new ControlService(makeClient({ ownerId: BOT_ID }));
    const v = await service.getVerdict(GUILD);
    expect(v.controlled).toBe(true);
    expect(v.mode).toBe('owner');
    expect(v.remediation).toBeNull();
  });

  it('grants control when the client holds the #1 role', async () => {
    const roles = [role('r-top', 'Top', 10), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: ['r-top'] }));
    const v = await service.getVerdict(GUILD);
    expect(v.controlled).toBe(true);
    expect(v.mode).toBe('role');
    expect(v.clientRole?.id).toBe('r-top');
    expect(v.topRole?.id).toBe('r-top');
  });

  it('denies control when a higher role exists above the client role', async () => {
    const roles = [role('r-higher', 'Higher', 20), role('r-client', 'Client', 10), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: ['r-client'] }));
    const v = await service.getVerdict(GUILD);
    expect(v.controlled).toBe(false);
    expect(v.remediation).toContain('#1');
    expect(v.ladder[0]!.isClient).toBe(false);
    expect(v.ladder[1]!.isClient).toBe(true);
  });

  it('denies control when the client has no role', async () => {
    const roles = [role('r-top', 'Top', 10), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: [] }));
    const v = await service.getVerdict(GUILD);
    expect(v.controlled).toBe(false);
    expect(v.clientRole).toBeNull();
  });

  it('flags @everyone in the ladder', async () => {
    const roles = [role('r-top', 'Top', 10), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: ['r-top'] }));
    const v = await service.getVerdict(GUILD);
    expect(v.ladder.some((r) => r.isEveryone)).toBe(true);
  });

  it('sorts the ladder highest-first', async () => {
    const roles = [role('r-low', 'Low', 1), role('r-high', 'High', 50), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: ['r-low'] }));
    const v = await service.getVerdict(GUILD);
    expect(v.ladder.map((r) => r.name)).toEqual(['High', 'Low', 'everyone']);
  });
});

describe('ControlService.assertControl', () => {
  it('resolves when control is granted', async () => {
    const service = new ControlService(makeClient({ ownerId: BOT_ID }));
    await expect(service.assertControl(GUILD)).resolves.toBeDefined();
  });

  it('throws ControlError when control is denied', async () => {
    const roles = [role('r-higher', 'Higher', 20), role('r-client', 'Client', 10), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: ['r-client'] }));
    await expect(service.assertControl(GUILD)).rejects.toBeInstanceOf(ControlError);
  });

  it('rejects guilds outside DISCORD_ALLOWED_GUILDS even when control is granted', async () => {
    const service = new ControlService(makeClient({ ownerId: BOT_ID }), [GUILD]);
    await expect(service.assertControl(GUILD)).resolves.toBeDefined();
    await expect(service.assertControl('4000000000000000000')).rejects.toThrow(/DISCORD_ALLOWED_GUILDS/);
    await expect(service.assertControl('4000000000000000000')).rejects.not.toBeInstanceOf(ControlError);
  });

  it('treats an empty allowlist as allow-all', async () => {
    const service = new ControlService(makeClient({ ownerId: BOT_ID }), []);
    await expect(service.assertControl(GUILD)).resolves.toBeDefined();
  });
});

describe('ControlService.elevateControl', () => {
  it('no-ops when already owner or controlled', async () => {
    const ownerService = new ControlService(makeClient({ ownerId: BOT_ID }));
    const ownerVerdict = await ownerService.elevateControl(GUILD);
    expect(ownerVerdict.controlled).toBe(true);

    const roles = [role('r-top', 'Top', 10), role(GUILD, 'everyone', 0)];
    const controlledService = new ControlService(makeClient({ roles, clientRoles: ['r-top'] }));
    const verdict = await controlledService.elevateControl(GUILD);
    expect(verdict.controlled).toBe(true);
    expect(controlledService['client'] === undefined).toBe(false);
  });

  it('attempts a reorder when the client role exists but is not top', async () => {
    const roles = [role('r-higher', 'Higher', 20), role('r-client', 'Client', 10), role(GUILD, 'everyone', 0)];
    const client = makeClient({ roles, clientRoles: ['r-client'] });
    client.reorderRoles = vi.fn(async () => {
      client.getRoles = vi.fn(async () => [role('r-client', 'Client', 20), role('r-higher', 'Higher', 10), role(GUILD, 'everyone', 0)]);
      return client.getRoles();
    });
    const service = new ControlService(client);
    const verdict = await service.elevateControl(GUILD);
    expect(client.reorderRoles).toHaveBeenCalledWith(GUILD, [{ id: 'r-client', position: 20 }]);
    expect(verdict.controlled).toBe(true);
  });

  it('throws when the client has no role', async () => {
    const roles = [role('r-top', 'Top', 10), role(GUILD, 'everyone', 0)];
    const service = new ControlService(makeClient({ roles, clientRoles: [] }));
    await expect(service.elevateControl(GUILD)).rejects.toBeInstanceOf(ControlError);
  });
});