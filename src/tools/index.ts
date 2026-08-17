import type { RegisteredTool } from './registry.js';
import { controlTools } from './controlTools.js';
import { guildTools } from './guildTools.js';
import { channelTools } from './channelTools.js';
import { memberTools } from './memberTools.js';
import { scaffoldTools } from './scaffoldTools.js';
import { oauthTools } from './oauthTools.js';

/**
 * Aggregate of every tool module. Order: auth/control first, then admin
 * (guild, channel, member), then scaffold, then OAuth2 bootstrap.
 */
export const tools: RegisteredTool[] = [
  ...controlTools,
  ...guildTools,
  ...channelTools,
  ...memberTools,
  ...scaffoldTools,
  ...oauthTools,
];