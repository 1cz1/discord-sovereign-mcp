#!/usr/bin/env node
/**
 * Evaluation runner for discord-sovereign-mcp.
 *
 *   node scripts/eval-runner.mjs          # offline: registry invariants (no token, no network)
 *   node scripts/eval-runner.mjs --live   # live: spawns the built server and runs protocol-level
 *                                         # checks + a scenario battery against real Discord
 *   node scripts/eval-runner.mjs --json   # machine-readable summary line
 *
 * Live mode requires:
 *   - `npm run build` first (spawns node dist/index.js)
 *   - DISCORD_TOKEN (+ optionally DISCORD_EVAL_GUILD_ID, DISCORD_EVAL_CHANNEL_ID) in .env
 *
 * Exit code 0 = all checks passed, 1 = any check failed.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const jsonOut = process.argv.includes('--json');
const live = process.argv.includes('--live');

const results = [];
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  if (!jsonOut) console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
};

async function offline() {
  console.log('[eval] offline registry checks');
  const r = spawnSync('npx', ['tsx', 'scripts/offline-check.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
  record(r.status === 0, 'offline registry invariants');
  return r.status === 0;
}

async function liveChecks() {
  console.log('[eval] live protocol checks');
  if (!process.env.DISCORD_TOKEN) {
    console.error('[eval] DISCORD_TOKEN is required for --live. See .env.example.');
    return false;
  }
  if (!existsSync('dist/index.js')) {
    console.error('[eval] dist/index.js not found: run `npm run build` first.');
    return false;
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    cwd: process.cwd(),
    env: { ...process.env, TRANSPORT: 'stdio' },
  });
  const client = new Client({ name: 'eval-runner', version: '0.1.0' });

  try {
    await client.connect(transport);
    record(true, 'connect', 'MCP initialize handshake');

    const listed = await client.listTools();
    record(listed.tools.length === 46, 'tools/list', `${listed.tools.length} tools`);

    const names = new Set(listed.tools.map((t) => t.name));
    const dupNames = listed.tools.length !== names.size;
    record(!dupNames, 'unique tool names');
    record([...names].every((n) => /^discord_[a-z0-9_]+$/.test(n) && n.length <= 64), 'naming conventions');

    const destructive = listed.tools.filter((t) => t.annotations?.destructiveHint ?? false).length;
    record(destructive > 0, 'destructive annotations', `${destructive} tools`);

    const whoami = await client.callTool({ name: 'discord_whoami', arguments: {} });
    record(!whoami.isError, 'discord_whoami', String(whoami.content?.[0]?.text ?? '').slice(0, 80));

    if (process.env.DISCORD_EVAL_GUILD_ID) {
      const guilds = await client.callTool({ name: 'discord_list_guilds', arguments: {} });
      const text = String(guilds.content?.[0]?.text ?? '');
      record(!guilds.isError && text.includes(process.env.DISCORD_EVAL_GUILD_ID), 'discord_list_guilds', 'target guild visible');

      const verdict = await client.callTool({ name: 'discord_assert_sovereignty', arguments: { guild_id: process.env.DISCORD_EVAL_GUILD_ID } });
      record(!verdict.isError, 'discord_assert_sovereignty');

      const channels = await client.callTool({ name: 'discord_list_channels', arguments: { guild_id: process.env.DISCORD_EVAL_GUILD_ID } });
      record(!channels.isError, 'discord_list_channels');
    } else {
      record(true, 'scenario battery', 'skipped (set DISCORD_EVAL_GUILD_ID)');
    }

    await client.close();
  } catch (err) {
    record(false, 'live run', err instanceof Error ? err.message : String(err));
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return failed === 0;
}

const ok = live ? await liveChecks() : await offline();
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

if (jsonOut) {
  console.log(JSON.stringify({ mode: live ? 'live' : 'offline', passed, failed, results }, null, 2));
} else {
  console.log(`\n[eval] ${passed} passed, ${failed} failed (${live ? 'live' : 'offline'})`);
}
process.exit(ok && failed === 0 ? 0 : 1);