import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SERVER_KEY,
  PACKAGE_SPEC,
  buildEnv,
  buildServerDefs,
  mergeJsonConfig,
  tomlEscape,
  buildTomlBlock,
  appendTomlBlock,
  resolveClientTargets,
  readEnvToken,
  upsertEnvToken,
} from '../src/bootstrap/installCli.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'installer-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildEnv', () => {
  it('emits the canonical env block', () => {
    expect(buildEnv('tok')).toEqual({
      DISCORD_TOKEN: 'tok',
      DISCORD_TOKEN_TYPE: 'auto',
      DISCORD_ALLOWED_GUILDS: '',
      TRANSPORT: 'stdio',
      LOG_LEVEL: 'info',
    });
  });
});

describe('buildServerDefs', () => {
  it('builds the npx standard definition', () => {
    const env = buildEnv('tok');
    expect(buildServerDefs(env).standard).toEqual({
      command: 'npx',
      args: [PACKAGE_SPEC],
      env,
    });
  });

  it('builds the opencode-specific definition', () => {
    const env = buildEnv('tok');
    expect(buildServerDefs(env).opencode).toEqual({
      type: 'local',
      command: ['npx', PACKAGE_SPEC],
      enabled: true,
      environment: env,
    });
  });
});

describe('mergeJsonConfig', () => {
  it('creates the servers object when absent', () => {
    const out = mergeJsonConfig({}, 'mcpServers', SERVER_KEY, { command: 'npx' });
    expect(out).toEqual({ mcpServers: { [SERVER_KEY]: { command: 'npx' } } });
  });

  it('merges into existing servers without clobbering other entries', () => {
    const out = mergeJsonConfig(
      { mcpServers: { other: { command: 'x' } }, top: 1 },
      'mcpServers',
      SERVER_KEY,
      { command: 'npx' }
    );
    expect(out).toEqual({
      mcpServers: { other: { command: 'x' }, [SERVER_KEY]: { command: 'npx' } },
      top: 1,
    });
  });

  it('does not mutate the input', () => {
    const input = { mcpServers: {} };
    mergeJsonConfig(input, 'mcpServers', SERVER_KEY, { command: 'npx' });
    expect(input).toEqual({ mcpServers: {} });
  });

  it('tolerates a non-object root and arrays', () => {
    expect(mergeJsonConfig('junk', 'mcpServers', SERVER_KEY, {}).mcpServers).toEqual({
      [SERVER_KEY]: {},
    });
    expect(mergeJsonConfig([1, 2], 'mcpServers', SERVER_KEY, {}).mcpServers).toEqual({
      [SERVER_KEY]: {},
    });
  });
});

describe('toml helpers', () => {
  it('escapes backslashes, quotes and newlines', () => {
    expect(tomlEscape('a\\b"c\nd')).toBe('a\\\\b\\"c d');
  });

  it('builds a complete server block', () => {
    const block = buildTomlBlock({ DISCORD_TOKEN: 'tok', TRANSPORT: 'stdio' });
    expect(block).toContain(`[mcp_servers.${SERVER_KEY}]`);
    expect(block).toContain('command = "npx"');
    expect(block).toContain(`args = ["${PACKAGE_SPEC}"]`);
    expect(block).toContain('DISCORD_TOKEN = "tok"');
  });
});

describe('appendTomlBlock', () => {
  it('appends the block once to a file without trailing newline', () => {
    const out = appendTomlBlock('k = "v"', buildTomlBlock({}));
    expect(out).toContain('[mcp_servers.' + SERVER_KEY + ']');
    expect(out.split('[mcp_servers.' + SERVER_KEY + ']').length).toBe(2);
  });

  it('is idempotent when the section already exists', () => {
    const existing = '[mcp_servers.' + SERVER_KEY + ']\ncommand = "npx"\n';
    expect(appendTomlBlock(existing, buildTomlBlock({}))).toBe(existing);
  });

  it('detects the section regardless of indentation', () => {
    const existing = '  [mcp_servers.' + SERVER_KEY + ']\n';
    expect(appendTomlBlock(existing, buildTomlBlock({}))).toBe(existing);
  });
});

describe('resolveClientTargets', () => {
  const project = '/proj';

  it('resolves windows paths', () => {
    const targets = resolveClientTargets({
      home: 'C:\\Users\\me',
      platform: 'win32',
      projectDir: 'C:\\proj',
    });
    const byPath = new Map(targets.map((t) => [t.path, t]));

    expect(byPath.get('C:\\proj\\.mcp.json')?.id).toBe('claude-code');
    expect(byPath.get('C:\\Users\\me\\.claude.json')?.scope).toBe('user');
    expect(byPath.get('C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json')?.id).toBe(
      'claude-desktop'
    );
    expect(byPath.get('C:\\proj\\.codex\\config.toml')?.format).toBe('toml');
    expect(byPath.get('C:\\proj\\.cursor\\mcp.json')?.id).toBe('cursor');
    expect(byPath.get('C:\\Users\\me\\.codeium\\windsurf\\mcp_config.json')?.id).toBe('windsurf');
    expect(byPath.get('C:\\Users\\me\\.continue\\config.json')?.id).toBe('continue');
    expect(byPath.get('C:\\proj\\.antigravity\\mcp.json')?.id).toBe('antigravity');
    expect(byPath.get('C:\\proj\\.vscode\\mcp.json')?.id).toBe('vscode');
  });

  it('resolves macos paths for claude-desktop', () => {
    const targets = resolveClientTargets({
      home: '/Users/me',
      platform: 'darwin',
      projectDir: project,
    });
    expect(targets.find((t) => t.id === 'claude-desktop')?.path).toBe(
      join('/Users/me', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    );
  });

  it('resolves linux paths for claude-desktop and opencode', () => {
    const targets = resolveClientTargets({
      home: '/home/me',
      platform: 'linux',
      projectDir: project,
    });
    expect(targets.find((t) => t.id === 'claude-desktop')?.path).toBe(
      join('/home/me', '.config', 'Claude', 'claude_desktop_config.json')
    );
    expect(targets.find((t) => t.id === 'opencode' && t.scope === 'user')?.path).toBe(
      join('/home/me', '.config', 'opencode', 'opencode.json')
    );
  });

  it('honors an explicit appData override', () => {
    const targets = resolveClientTargets({
      home: 'C:\\Users\\me',
      platform: 'win32',
      projectDir: 'C:\\proj',
      appData: 'D:\\custom\\appdata',
    });
    expect(targets.find((t) => t.id === 'claude-desktop')?.path).toBe(
      join('D:\\custom\\appdata', 'Claude', 'claude_desktop_config.json')
    );
  });
});

describe('.env token helpers', () => {
  it('readEnvToken returns null for missing files and missing keys', () => {
    const missing = join(tmp, 'nope.env');
    expect(readEnvToken(missing)).toBeNull();
    writeFileSync(missing, 'FOO=bar\n');
    expect(readEnvToken(missing)).toBeNull();
  });

  it('readEnvToken strips surrounding quotes', () => {
    const envPath = join(tmp, '.env');
    writeFileSync(envPath, 'FOO=bar\nDISCORD_TOKEN="quoted-token"\n');
    expect(readEnvToken(envPath)).toBe('quoted-token');
  });

  it('upsertEnvToken creates the file when absent', () => {
    const envPath = join(tmp, '.env');
    upsertEnvToken(envPath, 'tok-1');
    expect(existsSync(envPath)).toBe(true);
    expect(readEnvToken(envPath)).toBe('tok-1');
  });

  it('upsertEnvToken preserves other lines and replaces an existing token', () => {
    const envPath = join(tmp, '.env');
    writeFileSync(envPath, 'FOO=bar\nDISCORD_TOKEN=old\nBAZ=qux\n');
    upsertEnvToken(envPath, 'tok-2');
    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toContain('FOO=bar');
    expect(contents).toContain('BAZ=qux');
    expect(contents).not.toContain('DISCORD_TOKEN=old');
    expect(readEnvToken(envPath)).toBe('tok-2');
  });
});