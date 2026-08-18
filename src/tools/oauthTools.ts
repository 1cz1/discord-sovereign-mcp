import { z } from 'zod';
import { loadConfig } from '../config.js';
import {
  buildAuthorizationUrl,
  exchangeCode,
  fetchCurrentAuthorization,
  persistTokenToEnv,
  OAuthError,
  OAUTH_SCOPES,
} from '../services/oauthService.js';
import { ok, fail, type RegisteredTool, type ToolInput, type MCPResult } from './registry.js';

const ENV_PATH = '.env';

function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 8)}...${token.slice(-4)}` : '********';
}

const oauthStatus: RegisteredTool = {
  name: 'discord_oauth_status',
  title: 'OAuth2 status',
  description:
    'Reports the OAuth2 bootstrap state: transport, current token type, whether the Discord application ' +
    'credentials (DISCORD_OAUTH2_CLIENT_ID / SECRET / REDIRECT_URI) are configured, and the required scopes. ' +
    'Read-only. Run this before discord_oauth_login.',
  inputSchema: z.object({}).strict(),
  annotations: { readOnlyHint: true },
  handle: async (_params: ToolInput): Promise<MCPResult> => {
    const config = loadConfig();
    const configured = config.oauth.clientId.length > 0 && config.oauth.clientSecret.length > 0;
    const lines = [
      `Transport: **${config.transport}**`,
      `Token type: **${config.tokenType}**`,
      configured
        ? `OAuth2 application: configured (redirect ${config.oauth.redirectUri})`
        : `OAuth2 application: **not configured**: set DISCORD_OAUTH2_CLIENT_ID and DISCORD_OAUTH2_CLIENT_SECRET in .env`,
      `Scopes: ${OAUTH_SCOPES.join(', ')}`,
      config.tokenType === 'oauth2'
        ? 'The current token is an OAuth2 user token (from a previous bootstrap).'
        : 'The current token is a bot token. User-scope operations (creating guilds, joining servers) require the OAuth2 bootstrap.',
    ];
    return ok(lines.join('\n'), {
      transport: config.transport,
      token_type: config.tokenType,
      oauth_configured: configured,
      redirect_uri: config.oauth.redirectUri,
      scopes: OAUTH_SCOPES,
    });
  },
};

const oauthLogin: RegisteredTool = {
  name: 'discord_oauth_login',
  title: 'OAuth2 login URL',
  description:
    'Builds the Discord authorization URL for the user OAuth2 flow (scopes: identify, guilds, guilds.join, ' +
    'guilds.members.read). The user opens the URL, approves, and either the browser hits the local /callback route ' +
    '(TRANSPORT=http) or the user pastes the resulting code into discord_oauth_exchange (TRANSPORT=stdio).',
  inputSchema: z.object({}).strict(),
  handle: async (): Promise<MCPResult> => {
    const config = loadConfig();
    try {
      const url = buildAuthorizationUrl(config.oauth);
      const lines = [
        `Open this URL in a browser and authorize the application (redirect: ${config.oauth.redirectUri}):`,
        url,
        '',
        config.transport === 'http'
          ? 'The /callback route will exchange the code automatically and persist the token to .env.'
          : 'After approving, copy the `code` from the redirect URL (the `code=` query parameter) and call ' +
            'discord_oauth_exchange with it.',
      ];
      return ok(lines.join('\n'), { authorization_url: url, redirect_uri: config.oauth.redirectUri });
    } catch (err) {
      return fail(err instanceof OAuthError ? err.message : String(err));
    }
  },
};

interface OAuthExchangeInput {
  code: string;
  persist?: boolean;
}

const oauthExchangeSchema = z
  .object({
    code: z.string().min(1).describe('The authorization code from the redirect URL (?code=...) after the user approves.'),
    persist: z
      .boolean()
      .optional()
      .describe('Write the exchanged token into .env (DISCORD_TOKEN, DISCORD_TOKEN_TYPE=oauth2). Default true.'),
  })
  .strict();

const oauthExchange: RegisteredTool = {
  name: 'discord_oauth_exchange',
  title: 'Exchange OAuth2 code',
  description:
    'Exchanges an authorization code for a user access token, optionally persists it to .env, and verifies it ' +
    'against https://discord.com/api/v10/oauth2/@me. After persisting, restart the server so it authenticates with ' +
    'the user token (user-scope operations like discord_create_guild become available).',
  inputSchema: oauthExchangeSchema,
  handle: async (params: ToolInput): Promise<MCPResult> => {
    const p = params as unknown as OAuthExchangeInput;
    const config = loadConfig();
    try {
      const token = await exchangeCode(config.oauth, p.code);
      const identity = await fetchCurrentAuthorization(token.access_token);
      if (p.persist !== false) {
        persistTokenToEnv(ENV_PATH, token.access_token);
      }
      const username = identity.user ? `${identity.user.username} (${identity.user.id})` : 'unknown user';
      const lines = [
        `Token exchanged successfully for **${username}**.`,
        `Scopes granted: ${identity.scopes.length > 0 ? identity.scopes.join(', ') : '(none reported)'}`,
        `Token (masked): ${maskToken(token.access_token)}: expires in ${token.expires_in}s`,
        p.persist !== false
          ? 'Persisted to .env. Restart the server to use the user token (DISCORD_TOKEN_TYPE=oauth2).'
          : 'Not persisted (persist=false). The token is valid only for this process.',
      ];
      return ok(lines.join('\n'), {
        masked_access_token: maskToken(token.access_token),
        scopes: identity.scopes,
        user_id: identity.user?.id,
        user_username: identity.user?.username,
        persisted: p.persist !== false,
        expires_in: token.expires_in,
      });
    } catch (err) {
      return fail(err instanceof OAuthError ? err.message : String(err));
    }
  },
};

export const oauthTools: RegisteredTool[] = [oauthStatus, oauthLogin, oauthExchange];