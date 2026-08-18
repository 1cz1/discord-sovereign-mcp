/**
 * One-shot installer that wires discord-sovereign-mcp into every AI coding client:
 * Claude Code, Claude Desktop, Codex, opencode, Cursor, Windsurf, Continue,
 * Google Antigravity and VS Code.
 *
 * JSON configs are merged in place (idempotent — re-running is a no-op) with a
 * timestamped .bak backup of the original file. Codex's TOML config gets a single
 * [mcp_servers.discord-sovereign] block appended once.
 *
 * Run via `npm run install:mcp` or `npx discord-sovereign-mcp --install`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

export const SERVER_KEY = 'discord-sovereign';
export const PACKAGE_SPEC = 'discord-sovereign-mcp@latest';

export const CLIENT_IDS = [
  'claude-code',
  'claude-desktop',
  'codex',
  'opencode',
  'cursor',
  'windsurf',
  'continue',
  'antigravity',
  'vscode',
] as const;

export type ClientId = (typeof CLIENT_IDS)[number];

export interface ClientTarget {
  id: ClientId;
  label: string;
  scope: 'project' | 'user';
  path: string;
  format: 'json' | 'toml';
  key: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Builds the env block shared by every generated server definition. */
export function buildEnv(token: string): Record<string, string> {
  return {
    DISCORD_TOKEN: token,
    DISCORD_TOKEN_TYPE: 'auto',
    DISCORD_ALLOWED_GUILDS: '',
    TRANSPORT: 'stdio',
    LOG_LEVEL: 'info',
  };
}

/** Server definitions per client format. opencode uses a different schema. */
export function buildServerDefs(env: Record<string, string>): {
  standard: Record<string, unknown>;
  opencode: Record<string, unknown>;
} {
  return {
    standard: { command: 'npx', args: [PACKAGE_SPEC], env },
    opencode: { type: 'local', command: ['npx', PACKAGE_SPEC], enabled: true, environment: env },
  };
}

/**
 * Merges the server definition into an existing JSON config under the given
 * root key (mcpServers / mcp). Never mutates the input; returns a fresh object.
 */
export function mergeJsonConfig(
  existing: unknown,
  key: string,
  serverKey: string,
  serverDef: unknown
): Record<string, unknown> {
  const root = isPlainObject(existing) ? { ...existing } : {};
  const servers = isPlainObject(root[key]) ? { ...(root[key] as Record<string, unknown>) } : {};
  servers[serverKey] = serverDef;
  root[key] = servers;
  return root;
}

export function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

export function buildTomlBlock(env: Record<string, string>): string {
  const envInline = Object.entries(env)
    .map(([k, v]) => `${k} = "${tomlEscape(v)}"`)
    .join(', ');
  return [
    `[mcp_servers.${SERVER_KEY}]`,
    'command = "npx"',
    `args = ["${PACKAGE_SPEC}"]`,
    `env = { ${envInline} }`,
  ].join('\n');
}

/** Idempotent: if the server section already exists, the file is returned untouched. */
export function appendTomlBlock(existing: string, block: string): string {
  const sectionRe = new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_KEY.replace(/\./g, '\\.')}\\]`, 'm');
  if (sectionRe.test(existing)) return existing;
  const base = existing.endsWith('\n') ? existing : existing + '\n';
  return base + '\n' + block + '\n';
}

export interface PathOptions {
  home?: string;
  platform?: NodeJS.Platform;
  projectDir: string;
  appData?: string;
}

/** Resolves every candidate config file path for all supported clients. */
export function resolveClientTargets(opts: PathOptions): ClientTarget[] {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const project = opts.projectDir;
  const appData =
    opts.appData ?? (platform === 'win32' ? join(home, 'AppData', 'Roaming') : join(home, '.config'));

  const claudeDesktop =
    platform === 'win32'
      ? join(appData, 'Claude', 'claude_desktop_config.json')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : join(home, '.config', 'Claude', 'claude_desktop_config.json');

  const json = (id: ClientId, label: string, scope: 'project' | 'user', path: string): ClientTarget => ({
    id,
    label,
    scope,
    path,
    format: 'json',
    key: 'mcpServers',
  });
  const toml = (id: ClientId, label: string, scope: 'project' | 'user', path: string): ClientTarget => ({
    id,
    label,
    scope,
    path,
    format: 'toml',
    key: 'mcp_servers',
  });

  return [
    json('claude-code', 'Claude Code', 'project', join(project, '.mcp.json')),
    json('claude-code', 'Claude Code', 'user', join(home, '.claude.json')),
    json('claude-desktop', 'Claude Desktop', 'user', claudeDesktop),
    toml('codex', 'Codex', 'project', join(project, '.codex', 'config.toml')),
    toml('codex', 'Codex', 'user', join(home, '.codex', 'config.toml')),
    json('opencode', 'opencode', 'project', join(project, 'opencode.json')),
    json('opencode', 'opencode', 'user', join(home, '.config', 'opencode', 'opencode.json')),
    json('cursor', 'Cursor', 'project', join(project, '.cursor', 'mcp.json')),
    json('cursor', 'Cursor', 'user', join(home, '.cursor', 'mcp.json')),
    json('windsurf', 'Windsurf', 'project', join(project, '.windsurf', 'mcp_config.json')),
    json('windsurf', 'Windsurf', 'user', join(home, '.codeium', 'windsurf', 'mcp_config.json')),
    json('continue', 'Continue', 'user', join(home, '.continue', 'config.json')),
    json('antigravity', 'Google Antigravity', 'project', join(project, '.antigravity', 'mcp.json')),
    json('vscode', 'VS Code', 'project', join(project, '.vscode', 'mcp.json')),
  ];
}

/** Reads the DISCORD_TOKEN line out of a .env file (quotes stripped). */
export function readEnvToken(envPath: string): string | null {
  if (!existsSync(envPath)) return null;
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DISCORD_TOKEN='));
  if (!line) return null;
  const raw = line.slice('DISCORD_TOKEN='.length).trim();
  if (!raw) return null;
  return raw.replace(/^["']|["']$/g, '');
}

/** Sets or replaces DISCORD_TOKEN in a .env file, preserving every other line. */
export function upsertEnvToken(envPath: string, token: string): void {
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.startsWith('DISCORD_TOKEN='));
  if (idx >= 0) {
    lines[idx] = `DISCORD_TOKEN=${token}`;
  } else {
    lines.push(`DISCORD_TOKEN=${token}`);
  }
  let text = lines.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  writeFileSync(envPath, text, 'utf8');
}

function shorten(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function printHelp(): void {
  console.log(
    [
      'discord-sovereign-mcp installer',
      '',
      'Usage:',
      '  npx discord-sovereign-mcp --install [options]',
      '  npm run install:mcp -- [options]',
      '',
      'Options:',
      '  --all             install into every supported client (no prompts)',
      '  --client <id>     only the given client (repeatable; comma-separated ok)',
      '  --token <value>   bot token to write into configs (overrides .env)',
      '  --project <dir>   project directory for project-scoped configs (default: cwd)',
      '  --dry-run         show what would be written without touching anything',
      '  --no-prompt       non-interactive (writes detected configs only)',
      '  -h, --help        this help',
      '',
      'Clients:',
      `  ${CLIENT_IDS.join(', ')}`,
      '',
    ].join('\n')
  );
}

interface InstallOptions {
  all: boolean;
  dryRun: boolean;
  clients: ClientId[];
  projectDir: string;
  token: string | null;
  interactive: boolean;
  help: boolean;
}

export function parseOptions(
  argv: string[],
  env: Record<string, string | undefined>
): InstallOptions {
  const opts: InstallOptions = {
    all: false,
    dryRun: false,
    clients: [],
    projectDir: process.cwd(),
    token: env['DISCORD_TOKEN']?.trim() || null,
    interactive: true,
    help: false,
  };
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--all':
      case '-a':
        opts.all = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--no-prompt':
        opts.interactive = false;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--client':
      case '--clients': {
        const value = args[++i];
        if (value) {
          for (const id of value.split(',')) {
            if ((CLIENT_IDS as readonly string[]).includes(id)) opts.clients.push(id as ClientId);
          }
        }
        break;
      }
      case '--token': {
        const value = args[++i];
        if (value) opts.token = value;
        break;
      }
      case '--project': {
        const value = args[++i];
        if (value) opts.projectDir = value;
        break;
      }
      default:
        break;
    }
  }
  return opts;
}

async function pickTargets(
  detected: ClientTarget[],
  projectScoped: ClientTarget[]
): Promise<ClientTarget[]> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (detected.length > 0) {
      console.log('\nDetected client configs:');
      detected.forEach((t, i) => console.log(`  [${i + 1}] ${t.label} (${t.scope}) — ${shorten(t.path)}`));
      const answer = (await rl.question('\nInstall into all detected configs? [Y/n]: ')).trim().toLowerCase();
      let chosen: ClientTarget[];
      if (answer === 'n' || answer === 'no') {
        const pick = (await rl.question('Which ones? (comma-separated numbers): ')).trim();
        chosen = pick
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => n >= 1 && n <= detected.length)
          .map((n) => detected[n - 1]!)
          .filter((t) => t !== undefined);
      } else {
        chosen = detected;
      }
      const scaffolds = projectScoped.filter((t) => !chosen.includes(t));
      if (scaffolds.length > 0) {
        const create = (await rl.question('Also scaffold project configs in this repo? [y/N]: ')).trim().toLowerCase();
        if (create === 'y' || create === 'yes') chosen = chosen.concat(scaffolds);
      }
      return chosen;
    }
    const create = (
      await rl.question(
        'No existing client configs found. Scaffold project configs in this repo? [y/N]: '
      )
    )
      .trim()
      .toLowerCase();
    return create === 'y' || create === 'yes' ? projectScoped : [];
  } finally {
    rl.close();
  }
}

/**
 * Runs the installer. Returns an exit code; never calls process.exit itself so
 * callers (src/index.ts) can decide how to terminate.
 */
export async function runInstaller(
  argv: string[],
  env: Record<string, string | undefined>
): Promise<number> {
  const opts = parseOptions(argv, env);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const targets = resolveClientTargets({ projectDir: opts.projectDir });
  const detected = targets.filter((t) => existsSync(t.path));
  const projectScoped = targets.filter((t) => t.scope === 'project');

  let selected: ClientTarget[];
  if (opts.clients.length > 0) {
    selected = targets.filter((t) => opts.clients.includes(t.id));
    if (selected.length === 0) {
      console.error(`No client matched '${opts.clients.join(', ')}'. Valid clients: ${CLIENT_IDS.join(', ')}`);
      return 1;
    }
  } else if (opts.all) {
    selected = targets;
  } else if (opts.interactive && stdout.isTTY && stdin.isTTY) {
    selected = await pickTargets(detected, projectScoped);
  } else {
    selected = detected;
    if (detected.length === 0) {
      console.warn(
        'No existing client configs detected. Re-run with --all to scaffold project configs, ' +
          'or pass --project to point at your repo.'
      );
      return 1;
    }
  }

  if (selected.length === 0) {
    console.log('Nothing to install. Aborting.');
    return 0;
  }

  let token = opts.token;
  const envPath = join(opts.projectDir, '.env');
  if (!token) token = readEnvToken(envPath);
  const pasted = token === null && opts.interactive && stdin.isTTY;
  if (pasted) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question('\nNo DISCORD_TOKEN found. Paste a bot token (or leave empty): ')).trim();
      token = answer.length > 0 ? answer : null;
    } finally {
      rl.close();
    }
  }
  if (!token) {
    token = 'your-bot-or-oauth2-token';
    console.warn(
      '\nNo token provided — writing a placeholder. Set DISCORD_TOKEN in .env, paste one into the ' +
        'configs, or run `npx discord-sovereign-mcp --oauth` for a user token.'
    );
  }

  const envBlock = buildEnv(token);
  const defs = buildServerDefs(envBlock);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const target of selected) {
    const def = target.id === 'opencode' ? defs.opencode : defs.standard;
    const verb = opts.dryRun ? 'would write' : 'writing';
    if (target.format === 'toml') {
      const existing = existsSync(target.path) ? readFileSync(target.path, 'utf8') : '';
      const block = buildTomlBlock(envBlock);
      const next = appendTomlBlock(existing, block);
      if (next === existing) {
        skipped.push(`${target.label}: already configured (${shorten(target.path)})`);
        continue;
      }
      console.log(`${verb} ${target.label} → ${shorten(target.path)}`);
      if (!opts.dryRun) {
        backup(target.path);
        mkdirSync(dirname(target.path), { recursive: true });
        writeFileSync(target.path, next, 'utf8');
        written.push(target.path);
      }
    } else {
      let existing: unknown = {};
      if (existsSync(target.path)) {
        try {
          existing = JSON.parse(readFileSync(target.path, 'utf8'));
        } catch {
          skipped.push(`${target.label}: unparseable JSON, left untouched (${shorten(target.path)})`);
          continue;
        }
      }
      const next = mergeJsonConfig(existing, target.key, SERVER_KEY, def);
      console.log(`${verb} ${target.label} → ${shorten(target.path)}`);
      if (!opts.dryRun) {
        backup(target.path);
        mkdirSync(dirname(target.path), { recursive: true });
        writeFileSync(target.path, JSON.stringify(next, null, 2) + '\n', 'utf8');
        written.push(target.path);
      }
    }
  }

  if (pasted && token !== 'your-bot-or-oauth2-token' && !opts.dryRun) {
    upsertEnvToken(envPath, token);
    console.log(`\n✓ DISCORD_TOKEN written to ${shorten(envPath)}`);
  }

  if (written.length > 0) {
    console.log(
      `\n✓ ${written.length} config${written.length === 1 ? '' : 's'} ${opts.dryRun ? 'ready to be' : ''} written. ` +
        'Restart your AI client to pick up the change.'
    );
  }
  if (skipped.length > 0) {
    console.log('\nSkipped:');
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
  console.log(
    '\nNext steps:\n' +
      '  - Add guilds to DISCORD_ALLOWED_GUILDS (comma-separated IDs) to lock down which servers the LLM may touch.\n' +
      '  - Run `npx discord-sovereign-mcp --oauth` to bootstrap a user token instead of a bot.\n'
  );
  return 0;
}

function backup(path: string): void {
  if (!existsSync(path)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.${stamp}.bak`;
  try {
    writeFileSync(backupPath, readFileSync(path, 'utf8'), 'utf8');
    console.log(`  backed up → ${shorten(backupPath)}`);
  } catch {
    // backup is best-effort; never block the install over it
  }
}

const mainModule = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (mainModule !== '' && import.meta.url === mainModule) {
  runInstaller(process.argv.slice(2), process.env).then((code) => process.exit(code));
}