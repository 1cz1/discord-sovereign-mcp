import { REST } from '@discordjs/rest';
import type { RequestData } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { APIBan, APIChannel, APIGuild, APIGuildMember, APIMessage, APIRole, APIUser } from 'discord-api-types/payloads/v10';
import type {
  RESTPatchAPIGuildJSONBody,
  RESTPatchAPIGuildMemberJSONBody,
  RESTPatchAPIGuildRoleJSONBody,
  RESTPatchAPIGuildRolePositionsJSONBody,
  RESTPatchAPIChannelJSONBody,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIGuildRoleJSONBody,
  RESTPostAPIGuildsJSONBody,
  RESTPostAPIGuildChannelJSONBody,
  RESTPostAPIChannelThreadsJSONBody,
  RESTPostAPIChannelMessageJSONBody,
  RESTPutAPIGuildBanJSONBody,
  RESTPutAPIChannelPermissionJSONBody,
} from 'discord-api-types/rest/v10';
import type { TokenType } from '../config.js';

export type TokenKind = 'bot' | 'oauth2';

export interface Identity {
  id: string;
  username: string;
  globalName: string | null;
  bot: boolean;
  avatar: string | null;
}

export type RestMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RestTransport {
  get(route: string, options?: RequestData): Promise<unknown>;
  post(route: string, options?: RequestData): Promise<unknown>;
  put(route: string, options?: RequestData): Promise<unknown>;
  patch(route: string, options?: RequestData): Promise<unknown>;
  delete(route: string, options?: RequestData): Promise<unknown>;
}

export interface ClientOptions {
  token: string;
  tokenType: TokenType;
  transport?: RestTransport;
}

export interface MutationOptions {
  reason?: string;
}

export class DiscordClient {
  private rest: RestTransport;
  private kind: TokenKind;
  private identity: Identity | null = null;

  constructor(private readonly opts: ClientOptions) {
    this.kind = opts.tokenType === 'bot' ? 'bot' : opts.tokenType === 'auto' ? 'bot' : 'oauth2';
    this.rest = opts.transport ?? this.buildRest(this.kind);
  }

  private buildRest(kind: TokenKind): REST {
    const rest = new REST({
      version: '10',
      retries: 3,
      authPrefix: kind === 'bot' ? 'Bot' : 'Bearer',
    });
    rest.setToken(this.opts.token);
    return rest;
  }

  /** Resolves the real token kind (auto-detects bot vs user) and caches identity. */
  async init(): Promise<Identity> {
    if (this.identity) return this.identity;
    if (this.opts.tokenType === 'auto') {
      try {
        return await this.authorize('bot');
      } catch {
        return await this.authorize('oauth2');
      }
    }
    return await this.authorize(this.kind);
  }

  private async authorize(kind: TokenKind): Promise<Identity> {
    if (!this.opts.transport) {
      this.rest = this.buildRest(kind);
    }
    this.kind = kind;
    const me = (await this.rest.get(Routes.user('@me'), { auth: true })) as APIUser;
    if (this.opts.tokenType !== 'auto' && this.opts.tokenType !== 'bot' && me.bot) {
      throw new Error(
        'DISCORD_TOKEN is a bot token, but DISCORD_TOKEN_TYPE is not "bot". Set DISCORD_TOKEN_TYPE=bot ' +
          'or use an OAuth2/user token for server creation.'
      );
    }
    this.identity = {
      id: me.id,
      username: me.username,
      globalName: me.global_name ?? null,
      bot: me.bot ?? false,
      avatar: me.avatar ?? null,
    };
    return this.identity;
  }

  get me(): Identity {
    if (!this.identity) throw new Error('Client not initialized. Call init() first.');
    return this.identity;
  }

  get tokenKind(): TokenKind {
    return this.kind;
  }

  get isBot(): boolean {
    return this.kind === 'bot';
  }

  get isUser(): boolean {
    return this.kind === 'oauth2';
  }

  private async request<T>(method: RestMethod, route: string, options?: RequestData): Promise<T> {
    const fn = this.rest[method];
    if (typeof fn !== 'function') {
      throw new Error(`Transport does not implement ${method}.`);
    }
    return (await fn.call(this.rest, route, options)) as T;
  }

  // ── Identity ──────────────────────────────────────────────────────────

  // ── Guilds ─────────────────────────────────────────────────────────────

  async getGuilds(): Promise<APIGuild[]> {
    return this.request<APIGuild[]>('get', Routes.userGuilds());
  }

  async getGuild(guildId: string): Promise<APIGuild> {
    return this.request<APIGuild>('get', Routes.guild(guildId), { auth: true });
  }

  async createGuild(data: RESTPostAPIGuildsJSONBody): Promise<APIGuild> {
    if (this.isBot) {
      throw new Error(
        'Bots cannot create guilds via the Discord API. Complete the OAuth2 bootstrap ' +
          '(run `npm run oauth`) to obtain a user token, then retry: or set DISCORD_TOKEN to a user token.'
      );
    }
    return this.request<APIGuild>('post', Routes.guilds(), { body: data, auth: true });
  }

  async updateGuild(guildId: string, data: RESTPatchAPIGuildJSONBody, opts?: MutationOptions): Promise<APIGuild> {
    return this.request<APIGuild>('patch', Routes.guild(guildId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async deleteGuild(guildId: string): Promise<void> {
    if (this.isBot) {
      throw new Error('Bots cannot delete guilds. Use a user token (OAuth2 bootstrap) for this operation.');
    }
    await this.request('delete', Routes.guild(guildId), { auth: true });
  }

  // ── Roles ──────────────────────────────────────────────────────────────

  async getRoles(guildId: string): Promise<APIRole[]> {
    return this.request<APIRole[]>('get', Routes.guildRoles(guildId), { auth: true });
  }

  async createRole(guildId: string, data: RESTPostAPIGuildRoleJSONBody, opts?: MutationOptions): Promise<APIRole> {
    return this.request<APIRole>('post', Routes.guildRoles(guildId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async updateRole(
    guildId: string,
    roleId: string,
    data: RESTPatchAPIGuildRoleJSONBody,
    opts?: MutationOptions
  ): Promise<APIRole> {
    return this.request<APIRole>('patch', Routes.guildRole(guildId, roleId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async deleteRole(guildId: string, roleId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.guildRole(guildId, roleId), {
      auth: true,
      reason: opts?.reason,
    });
  }

  async reorderRoles(
    guildId: string,
    positions: { id: string; position: number }[],
    opts?: MutationOptions
  ): Promise<APIRole[]> {
    const body: RESTPatchAPIGuildRolePositionsJSONBody = positions;
    return this.request<APIRole[]>('patch', Routes.guildRoles(guildId), {
      body,
      auth: true,
      reason: opts?.reason,
    });
  }

  // ── Channels ───────────────────────────────────────────────────────────

  async getChannels(guildId: string): Promise<APIChannel[]> {
    return this.request<APIChannel[]>('get', Routes.guildChannels(guildId), { auth: true });
  }

  async getChannel(channelId: string): Promise<APIChannel> {
    return this.request<APIChannel>('get', Routes.channel(channelId), { auth: true });
  }

  async createChannel(guildId: string, data: RESTPostAPIGuildChannelJSONBody, opts?: MutationOptions): Promise<APIChannel> {
    return this.request<APIChannel>('post', Routes.guildChannels(guildId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async updateChannel(channelId: string, data: RESTPatchAPIChannelJSONBody, opts?: MutationOptions): Promise<APIChannel> {
    return this.request<APIChannel>('patch', Routes.channel(channelId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async deleteChannel(channelId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.channel(channelId), { auth: true, reason: opts?.reason });
  }

  async createThread(channelId: string, data: RESTPostAPIChannelThreadsJSONBody, opts?: MutationOptions): Promise<APIChannel> {
    return this.request<APIChannel>('post', Routes.threads(channelId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async getActiveThreads(guildId: string): Promise<APIChannel[]> {
    return this.request<APIChannel[]>('get', Routes.guildActiveThreads(guildId), { auth: true });
  }

  // ── Members ────────────────────────────────────────────────────────────

  async listMembers(
    guildId: string,
    query: { limit?: number; after?: string } = {}
  ): Promise<APIGuildMember[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.after !== undefined) params.set('after', query.after);
    return this.request<APIGuildMember[]>('get', Routes.guildMembers(guildId), {
      query: params,
      auth: true,
    });
  }

  async searchMembers(guildId: string, query: string, limit = 10): Promise<APIGuildMember[]> {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', String(limit));
    return this.request<APIGuildMember[]>('get', Routes.guildMembersSearch(guildId), {
      query: params,
      auth: true,
    });
  }

  async getMember(guildId: string, userId: string): Promise<APIGuildMember> {
    return this.request<APIGuildMember>('get', Routes.guildMember(guildId, userId), { auth: true });
  }

  async updateMember(
    guildId: string,
    userId: string,
    data: RESTPatchAPIGuildMemberJSONBody,
    opts?: MutationOptions
  ): Promise<APIGuildMember> {
    return this.request<APIGuildMember>('patch', Routes.guildMember(guildId, userId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async addMemberRole(guildId: string, userId: string, roleId: string, opts?: MutationOptions): Promise<void> {
    await this.request('put', Routes.guildMemberRole(guildId, userId, roleId), {
      auth: true,
      reason: opts?.reason,
    });
  }

  async removeMemberRole(guildId: string, userId: string, roleId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.guildMemberRole(guildId, userId, roleId), {
      auth: true,
      reason: opts?.reason,
    });
  }

  async removeMember(guildId: string, userId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.guildMember(guildId, userId), { auth: true, reason: opts?.reason });
  }

  async banMember(guildId: string, userId: string, data: RESTPutAPIGuildBanJSONBody, opts?: MutationOptions): Promise<void> {
    await this.request('put', Routes.guildBan(guildId, userId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async unbanMember(guildId: string, userId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.guildBan(guildId, userId), { auth: true, reason: opts?.reason });
  }

  async getBans(guildId: string): Promise<APIBan[]> {
    const all: APIBan[] = [];
    let after: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ limit: '1000' });
      if (after !== undefined) params.set('after', after);
      const page = await this.request<APIBan[]>('get', Routes.guildBans(guildId), {
        query: params,
        auth: true,
      });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.user.id;
    }
    return all;
  }

  async getBan(guildId: string, userId: string): Promise<APIBan> {
    return this.request<APIBan>('get', Routes.guildBan(guildId, userId), { auth: true });
  }

  // ── Permission overwrites ──────────────────────────────────────────────

  async setPermissionOverwrite(
    channelId: string,
    overwriteId: string,
    data: RESTPutAPIChannelPermissionJSONBody,
    opts?: MutationOptions
  ): Promise<APIChannel> {
    return this.request<APIChannel>('put', Routes.channelPermission(channelId, overwriteId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async deletePermissionOverwrite(channelId: string, overwriteId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.channelPermission(channelId, overwriteId), {
      auth: true,
      reason: opts?.reason,
    });
  }

  // ── Messages ───────────────────────────────────────────────────────────

  async sendMessage(channelId: string, data: RESTPostAPIChannelMessageJSONBody, opts?: MutationOptions): Promise<APIMessage> {
    return this.request<APIMessage>('post', Routes.channelMessages(channelId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async getMessages(
    channelId: string,
    query: { limit?: number; around?: string; before?: string; after?: string } = {}
  ): Promise<APIMessage[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.around !== undefined) params.set('around', query.around);
    if (query.before !== undefined) params.set('before', query.before);
    if (query.after !== undefined) params.set('after', query.after);
    return this.request<APIMessage[]>('get', Routes.channelMessages(channelId), { query: params, auth: true });
  }

  async getMessage(channelId: string, messageId: string): Promise<APIMessage> {
    return this.request<APIMessage>('get', Routes.channelMessage(channelId, messageId), { auth: true });
  }

  async editMessage(
    channelId: string,
    messageId: string,
    data: RESTPatchAPIChannelMessageJSONBody,
    opts?: MutationOptions
  ): Promise<APIMessage> {
    return this.request<APIMessage>('patch', Routes.channelMessage(channelId, messageId), {
      body: data,
      auth: true,
      reason: opts?.reason,
    });
  }

  async deleteMessage(channelId: string, messageId: string, opts?: MutationOptions): Promise<void> {
    await this.request('delete', Routes.channelMessage(channelId, messageId), {
      auth: true,
      reason: opts?.reason,
    });
  }

  async bulkDeleteMessages(channelId: string, messageIds: string[], opts?: MutationOptions): Promise<void> {
    await this.request('post', Routes.channelBulkDelete(channelId), {
      body: { messages: messageIds },
      auth: true,
      reason: opts?.reason,
    });
  }
}