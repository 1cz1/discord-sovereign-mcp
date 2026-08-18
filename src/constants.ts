import { ChannelType } from 'discord-api-types/v10';

export const SERVER_NAME = 'discord-sovereign-mcp';
export const VERSION = '0.2.0';

export const CHARACTER_LIMIT = 25_000;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const DEFAULT_AUDIT_REASON = 'via discord-sovereign-mcp';
export const TIMEOUT_MAX_MINUTES = 40_320; // 28 days
export const REQUEST_TIMEOUT_MS = 30_000;

export const GUILD_CHANNEL_TYPE_LABELS: Record<number, string> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildMedia]: 'media',
};

export const CHANNEL_TYPE_LABELS: Record<string, number> = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia,
};

export const ROLE_COLOR_PALETTE: Record<string, number> = {
  default: 0,
  gray: 0x99aab5,
  darkgray: 0x2c2f33,
  black: 0x000000,
  white: 0xffffff,
  red: 0xe74c3c,
  orange: 0xe67e22,
  yellow: 0xf1c40f,
  green: 0x2ecc71,
  darkgreen: 0x1f8b4c,
  blue: 0x3498db,
  darkblue: 0x206694,
  purple: 0x9b59b6,
  darkpurple: 0x71368a,
  magenta: 0xe91e63,
  pink: 0xff69b4,
  darkred: 0x992d22,
  teal: 0x1abc9c,
  cyan: 0x00ffff,
  blurple: 0x5865f2,
  pink2: 0xff73fa,
};