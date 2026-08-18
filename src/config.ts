export type TokenType = 'auto' | 'bot' | 'oauth2' | 'user';
export type Transport = 'stdio' | 'http';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
}

export interface Config {
  token: string;
  tokenType: TokenType;
  allowedGuilds: string[];
  transport: Transport;
  httpHost: string;
  httpPort: number;
  oauth: OAuthConfig;
  auditReason: string;
  logLevel: 'info' | 'debug' | 'warn' | 'error';
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parses the OAuth2 env block. Shared by loadConfig and the OAuth bootstrap. */
export function buildOAuthConfig(env: Record<string, string | undefined>): OAuthConfig {
  const port = Number(env['DISCORD_OAUTH2_PORT'] ?? 8788);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`Invalid DISCORD_OAUTH2_PORT '${env['DISCORD_OAUTH2_PORT']}'.`);
  }
  return {
    clientId: env['DISCORD_OAUTH2_CLIENT_ID'] ?? '',
    clientSecret: env['DISCORD_OAUTH2_CLIENT_SECRET'] ?? '',
    redirectUri: env['DISCORD_OAUTH2_REDIRECT_URI'] ?? 'http://localhost:8788/callback',
    port,
  };
}

function parseEnv(env: Record<string, string | undefined>): Config {
  const token = env['DISCORD_TOKEN']?.trim() ?? '';
  if (!token) {
    throw new ConfigError(
      'DISCORD_TOKEN is required. Create a bot at https://discord.com/developers/applications ' +
        'or complete the OAuth2 bootstrap (see README).'
    );
  }
  const tokenType = (env['DISCORD_TOKEN_TYPE'] ?? 'auto').toLowerCase() as TokenType;
  if (!['auto', 'bot', 'oauth2', 'user'].includes(tokenType)) {
    throw new ConfigError(
      `Invalid DISCORD_TOKEN_TYPE '${tokenType}'. Use auto | bot | oauth2 | user.`
    );
  }
  const transport = (env['TRANSPORT'] ?? 'stdio').toLowerCase() as Transport;
  if (!['stdio', 'http'].includes(transport)) {
    throw new ConfigError(`Invalid TRANSPORT '${transport}'. Use stdio | http.`);
  }
  const httpPort = Number(env['HTTP_PORT'] ?? 3000);
  if (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65535) {
    throw new ConfigError(`Invalid HTTP_PORT '${env['HTTP_PORT']}'.`);
  }
  const logLevel = (env['LOG_LEVEL'] ?? 'info').toLowerCase() as Config['logLevel'];
  if (!['info', 'debug', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError(`Invalid LOG_LEVEL '${env['LOG_LEVEL']}'.`);
  }
  return {
    token,
    tokenType,
    allowedGuilds: (env['DISCORD_ALLOWED_GUILDS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    transport,
    httpHost: env['HTTP_HOST'] ?? '127.0.0.1',
    httpPort,
    oauth: buildOAuthConfig(env),
    auditReason: env['AUDIT_REASON'] ?? 'via discord-sovereign-mcp',
    logLevel,
  };
}

let cached: Config | null = null;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  if (!cached) cached = parseEnv(env);
  return cached;
}

export function isGuildAllowed(config: Config, guildId: string): boolean {
  return config.allowedGuilds.length === 0 || config.allowedGuilds.includes(guildId);
}

export function assertGuildAllowed(config: Config, guildId: string): void {
  if (!isGuildAllowed(config, guildId)) {
    throw new Error(
      `Guild ${guildId} is not in DISCORD_ALLOWED_GUILDS. Add it to the allowlist in .env to manage it.`
    );
  }
}