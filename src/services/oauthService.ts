import { readFileSync, writeFileSync } from 'node:fs';
import { OAuth2Scopes } from 'discord-api-types/v10';
import type { RESTGetAPIOAuth2CurrentAuthorizationResult, RESTPostOAuth2AccessTokenResult } from 'discord-api-types/rest/v10';
import type { OAuthConfig } from '../config.js';

const API_BASE = 'https://discord.com/api/v10';
const TOKEN_URL = `${API_BASE}/oauth2/token`;
const CURRENT_AUTHORIZATION_URL = `${API_BASE}/oauth2/@me`;

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** Scopes required by the server: identity, guild visibility, guild join (invite bootstrap), member read. */
export const OAUTH_SCOPES = [
  OAuth2Scopes.Identify,
  OAuth2Scopes.Guilds,
  OAuth2Scopes.GuildsJoin,
  OAuth2Scopes.GuildsMembersRead,
];

export function buildAuthorizationUrl(cfg: OAuthConfig): string {
  if (!cfg.clientId) {
    throw new OAuthError(
      'DISCORD_OAUTH2_CLIENT_ID is not set. Create an application at ' +
        'https://discord.com/developers/applications, add a redirect of ' +
        `${cfg.redirectUri} under OAuth2, and set the env vars in .env.`
    );
  }
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    scope: OAUTH_SCOPES.join(' '),
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(cfg: OAuthConfig, code: string): Promise<RESTPostOAuth2AccessTokenResult> {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new OAuthError(
      'DISCORD_OAUTH2_CLIENT_ID / DISCORD_OAUTH2_CLIENT_SECRET must be set to exchange an authorization code.'
    );
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = (await res.json()) as { error?: string; error_description?: string };
      detail = data.error_description ?? data.error ?? res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new OAuthError(`Token exchange failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as RESTPostOAuth2AccessTokenResult;
}

export async function fetchCurrentAuthorization(accessToken: string): Promise<RESTGetAPIOAuth2CurrentAuthorizationResult> {
  const res = await fetch(CURRENT_AUTHORIZATION_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new OAuthError(`Could not read current authorization (${res.status}). The token may be invalid or expired.`);
  }
  return (await res.json()) as RESTGetAPIOAuth2CurrentAuthorizationResult;
}

/**
 * Writes the exchanged token into the .env file (DISCORD_TOKEN /
 * DISCORD_TOKEN_TYPE=oauth2), preserving every other line.
 */
export function persistTokenToEnv(envPath: string, token: string): void {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  const setKey = (key: string, value: string): void => {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) {
      lines[idx] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  };
  setKey('DISCORD_TOKEN_TYPE', 'oauth2');
  setKey('DISCORD_TOKEN', token);
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
}