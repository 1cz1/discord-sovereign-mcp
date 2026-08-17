import { describe, expect, it, vi } from 'vitest';
import type { APIRole, APIGuild, APIGuildMember, APIChannel } from 'discord-api-types/payloads/v10';
import type { DiscordClient } from '../src/client/discordClient.js';
import { ControlService } from '../src/services/controlService.js';
import { scaffoldTools } from '../src/tools/scaffoldTools.js';
import { controlTools } from '../src/tools/controlTools.js';
import { tools as allTools } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/registry.js';

const GUILD = '1000000000000000000';
const BOT_ID = '2000000000000000000';

const scaffoldTool = scaffoldTools[0]!;
const assertSovereignty = controlTools[0]!;
const elevateControl = controlTools[1]!;

function role(id: string, name: string, position: number): APIRole {
  return { id, name, position, color: 0, hoist: false, icon: null, unicode_emoji: null, managed: false, mentionable: false, permissions: '0', flags: 0 } as unknown as APIRole;
}

function makeClient(): any {
  const calls = {
    roles: [] as string[],
    channels: [] as string[],
    overwrites: [] as [string, string, { allow: string; deny: string }][],
  };
  const client = {
    me: { id: BOT_ID, username: 'bot', bot: true },
    getGuild: vi.fn(async (): Promise<APIGuild> => ({ id: GUILD, owner_id: '3000000000000000000' } as unknown as APIGuild)),
    getRoles: vi.fn(async (): Promise<APIRole[]> => [role('r-top', 'Top', 10), role(GUILD, 'everyone', 0)]),
    getMember: vi.fn(async (): Promise<APIGuildMember> => ({ roles: ['r-top'] } as unknown as APIGuildMember)),
    createRole: vi.fn(async (_g: string, data: any): Promise<APIRole> => {
      calls.roles.push(data.name);
      return role(`role-${calls.roles.length}`, data.name, calls.roles.length);
    }),
    createChannel: vi.fn(async (_g: string, data: any): Promise<APIChannel> => {
      calls.channels.push(data.name);
      return { id: `chan-${calls.channels.length}`, name: data.name, type: data.type } as unknown as APIChannel;
    }),
    setPermissionOverwrite: vi.fn(async (channelId: string, targetId: string, body: any): Promise<APIChannel> => {
      calls.overwrites.push([channelId, targetId, body]);
      return { id: channelId } as unknown as APIChannel;
    }),
    reorderRoles: vi.fn(),
  };
  return { client, calls };
}

function ctx(client: any): ToolContext {
  return { client: client as unknown as DiscordClient, control: new ControlService(client) };
}

describe('discord_scaffold_server', () => {
  it('returns a preview on dry_run without touching the client', async () => {
    const { client, calls } = makeClient();
    const result = await scaffoldTool.handle({ guild_id: GUILD, template: 'minimal', dry_run: true }, ctx(client));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.dry_run).toBe(true);
    expect(result.structuredContent?.template).toBe('minimal');
    expect(result.structuredContent?.roles).toHaveLength(3);
    expect(client.createRole).not.toHaveBeenCalled();
    expect(client.createChannel).not.toHaveBeenCalled();
    expect(calls.roles).toHaveLength(0);
  });

  it('applies the plan when dry_run=false, honoring the guard', async () => {
    const { client, calls } = makeClient();
    const result = await scaffoldTool.handle(
      { guild_id: GUILD, template: 'minimal', dry_run: false },
      ctx(client)
    );
    expect(result.isError).toBeUndefined();
    expect(calls.roles).toEqual(['Member', 'Moderator', 'Administrator']);
    expect(calls.channels).toContain('general');
    expect(calls.channels).toContain('general-vc');
    // parent_id wiring: the text channel is created under the category
    const createCalls = client.createChannel.mock.calls as [string, any][];
    const categoryCall = createCalls.find(([, d]) => d.name === 'general' && d.type === 4);
    expect(categoryCall).toBeDefined();
    const textCall = createCalls.find(([, d]) => d.name === 'general' && d.type === 0);
    expect(textCall![1].parent_id).toBe('chan-1');
    expect(result.structuredContent?.steps_completed).toBe(result.structuredContent?.steps_total);
  });

  it('denies execution when the guard is not satisfied and mutates nothing', async () => {
    const { client, calls } = makeClient();
    client.getRoles = vi.fn(async () => [role('r-higher', 'Higher', 20), role('r-client', 'Client', 10), role(GUILD, 'everyone', 0)]);
    client.getMember = vi.fn(async () => ({ roles: ['r-client'] } as unknown as APIGuildMember));
    const result = await scaffoldTool.handle({ guild_id: GUILD, template: 'minimal', dry_run: false }, ctx(client));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Sovereignty Guard');
    expect(calls.roles).toHaveLength(0);
    expect(calls.channels).toHaveLength(0);
  });
});

describe('discord_assert_sovereignty', () => {
  it('reports the verdict and ladder', async () => {
    const { client } = makeClient();
    const result = await assertSovereignty.handle({ guild_id: GUILD }, ctx(client));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.controlled).toBe(true);
    expect(result.structuredContent?.mode).toBe('role');
    expect(result.content[0]!.text).toContain('granted');
  });

  it('reports denial with remediation', async () => {
    const { client } = makeClient();
    client.getRoles = vi.fn(async () => [role('r-higher', 'Higher', 20), role('r-client', 'Client', 10), role(GUILD, 'everyone', 0)]);
    client.getMember = vi.fn(async () => ({ roles: ['r-client'] } as unknown as APIGuildMember));
    const result = await assertSovereignty.handle({ guild_id: GUILD }, ctx(client));
    expect(result.structuredContent?.controlled).toBe(false);
    expect(result.content[0]!.text).toContain('denied');
  });
});

describe('discord_elevate_control', () => {
  it('previews without mutating on dry_run', async () => {
    const { client } = makeClient();
    const result = await elevateControl.handle({ guild_id: GUILD, dry_run: true }, ctx(client));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.dry_run).toBe(true);
    expect(client.reorderRoles).not.toHaveBeenCalled();
  });
});

describe('tool inventory', () => {
  it('registers 46 tools with unique, snake_case, discord_-prefixed names', () => {
    expect(allTools.length).toBe(46);
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(46);
    for (const name of names) {
      expect(name).toMatch(/^discord_[a-z0-9_]{1,63}$/);
      expect(name.length).toBeLessThanOrEqual(64);
    }
  });

  it('has no duplicate titles and marks destructive tools', () => {
    const titles = allTools.map((t) => t.title);
    expect(new Set(titles).size).toBe(46);
    for (const t of allTools) {
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(20);
    }
    const destructive = allTools.filter((t) => t.annotations?.destructiveHint);
    expect(destructive.length).toBeGreaterThan(10);
  });
});