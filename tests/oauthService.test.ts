import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAuthorizationUrl,
  persistTokenToEnv,
  OAUTH_SCOPES,
  OAuthError,
} from '../src/services/oauthService.js';

const BASE_CFG = { clientId: '123456', clientSecret: 'secret', redirectUri: 'http://localhost:8788/callback', port: 8788 };

describe('buildAuthorizationUrl', () => {
  it('throws without a client id', () => {
    expect(() => buildAuthorizationUrl({ ...BASE_CFG, clientId: '' })).toThrow(OAuthError);
  });

  it('builds a URL with the required scopes and redirect', () => {
    const url = buildAuthorizationUrl(BASE_CFG);
    expect(url.startsWith('https://discord.com/oauth2/authorize?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe('123456');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('redirect_uri')).toBe('http://localhost:8788/callback');
    const scopes = params.get('scope')!.split(' ');
    expect(scopes).toContain('identify');
    expect(scopes).toContain('guilds');
    expect(scopes).toContain('guilds.join');
    expect(scopes).toContain('guilds.members.read');
    expect(OAUTH_SCOPES.length).toBeGreaterThanOrEqual(4);
  });
});

describe('persistTokenToEnv', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsm-oauth-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('updates DISCORD_TOKEN and DISCORD_TOKEN_TYPE in place, preserving other lines', () => {
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'DISCORD_TOKEN=old-token\nTRANSPORT=http\n# keep me\n', 'utf8');
    persistTokenToEnv(envPath, 'new-token');
    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('DISCORD_TOKEN=new-token');
    expect(content).toContain('DISCORD_TOKEN_TYPE=oauth2');
    expect(content).toContain('TRANSPORT=http');
    expect(content).toContain('# keep me');
  });

  it('appends the keys when missing', () => {
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'LOG_LEVEL=debug\n', 'utf8');
    persistTokenToEnv(envPath, 'abc');
    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('DISCORD_TOKEN=abc');
    expect(content).toContain('DISCORD_TOKEN_TYPE=oauth2');
    expect(content).toContain('LOG_LEVEL=debug');
  });

  it('does not duplicate keys on repeated writes', () => {
    const envPath = join(dir, '.env');
    writeFileSync(envPath, '', 'utf8');
    persistTokenToEnv(envPath, 'one');
    persistTokenToEnv(envPath, 'two');
    const content = readFileSync(envPath, 'utf8');
    expect(content.match(/DISCORD_TOKEN=/g)).toHaveLength(1);
    expect(content).toContain('DISCORD_TOKEN=two');
    expect(content.match(/DISCORD_TOKEN_TYPE=/g)).toHaveLength(1);
  });
});