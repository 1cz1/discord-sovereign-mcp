import { CHANNEL_TYPE_LABELS, ROLE_COLOR_PALETTE } from '../constants.js';
import { permissionNamesToBits, PermissionError } from './permissionService.js';

export type ScaffoldChannelType = 'text' | 'voice' | 'category' | 'announcement' | 'forum';

export interface PlanRole {
  name: string;
  permissions: string[];
  color: string;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface PlanChannel {
  name: string;
  type: ScaffoldChannelType;
  topic?: string;
}

export interface PlanOverwrite {
  /** Channel name as declared in `channels` (resolved to id at execute time). */
  channel: string;
  /** Role name as declared in `roles`, or '@everyone' for the @everyone role. */
  role: string;
  allow?: string[];
  deny?: string[];
}

export interface ScaffoldPlan {
  guildId: string;
  template: string;
  roles: PlanRole[];
  channels: PlanChannel[];
  overwrites: PlanOverwrite[];
}

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldError';
  }
}

export type ScaffoldStep =
  | { kind: 'role'; label: string; role: PlanRole }
  | { kind: 'channel'; label: string; channel: PlanChannel; parentName?: string }
  | { kind: 'overwrite'; label: string; overwrite: PlanOverwrite };

const MEMBER_BASE_PERMISSIONS = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'AddReactions',
  'AttachFiles',
  'EmbedLinks',
  'CreateInstantInvite',
  'UseExternalEmojis',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'UseApplicationCommands',
  'Connect',
  'Speak',
];

const MODERATOR_EXTRA_PERMISSIONS = [
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ManageMessages',
  'ManageThreads',
  'ManageNicknames',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
];

function adminRole(): PlanRole {
  return { name: 'Administrator', permissions: ['Administrator'], color: 'red', hoist: true, mentionable: false };
}

function modRole(): PlanRole {
  return { name: 'Moderator', permissions: [...MEMBER_BASE_PERMISSIONS, ...MODERATOR_EXTRA_PERMISSIONS], color: 'blue', hoist: true };
}

function memberRole(): PlanRole {
  return { name: 'Member', permissions: [...MEMBER_BASE_PERMISSIONS], color: 'default' };
}

/** Minimal: one category, one text, one voice, three roles. */
function minimalTemplate(): { roles: PlanRole[]; channels: PlanChannel[]; overwrites: PlanOverwrite[] } {
  return {
    roles: [memberRole(), modRole(), adminRole()],
    channels: [
      { name: 'general', type: 'category' },
      { name: 'general', type: 'text', topic: 'General discussion' },
      { name: 'general-vc', type: 'voice' },
    ],
    overwrites: [],
  };
}

/** Community: announcement + info channels, community + support categories, staff-only lounge. */
function communityTemplate(): { roles: PlanRole[]; channels: PlanChannel[]; overwrites: PlanOverwrite[] } {
  return {
    roles: [memberRole(), modRole(), adminRole()],
    channels: [
      { name: 'information', type: 'category' },
      { name: 'announcements', type: 'announcement', topic: 'Official announcements and changelogs' },
      { name: 'welcome', type: 'text', topic: 'Say hi! Read the rules before posting.' },
      { name: 'rules', type: 'text', topic: 'Server rules' },
      { name: 'community', type: 'category' },
      { name: 'general', type: 'text', topic: 'General discussion' },
      { name: 'introductions', type: 'text', topic: 'Introduce yourself' },
      { name: 'showcase', type: 'text', topic: 'Share your work' },
      { name: 'memes', type: 'text', topic: 'Memes only' },
      { name: 'support', type: 'category' },
      { name: 'help', type: 'text', topic: 'Ask for help' },
      { name: 'feedback', type: 'text', topic: 'Suggestions and feedback' },
      { name: 'voice', type: 'category' },
      { name: 'general-vc', type: 'voice' },
      { name: 'gaming-vc', type: 'voice' },
      { name: 'music-vc', type: 'voice' },
      { name: 'staff', type: 'category' },
      { name: 'staff-chat', type: 'text', topic: 'Staff-only' },
    ],
    overwrites: [
      { channel: 'staff', role: '@everyone', deny: ['ViewChannel'] },
      { channel: 'staff', role: 'Moderator', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    ],
  };
}

/** Gaming: game chat categories, LFG channel, voice lounges, announcements. */
function gamingTemplate(): { roles: PlanRole[]; channels: PlanChannel[]; overwrites: PlanOverwrite[] } {
  return {
    roles: [memberRole(), modRole(), adminRole()],
    channels: [
      { name: 'announcements', type: 'category' },
      { name: 'game-news', type: 'announcement', topic: 'Patch notes and game news' },
      { name: 'patch-notes', type: 'text', topic: 'Discussion of patches' },
      { name: 'game-chat', type: 'category' },
      { name: 'general', type: 'text', topic: 'General gaming chat' },
      { name: 'looking-for-group', type: 'text', topic: 'Find a squad — post game, rank, region' },
      { name: 'clips', type: 'text', topic: 'Share your best moments' },
      { name: 'voice', type: 'category' },
      { name: 'game-vc-1', type: 'voice' },
      { name: 'game-vc-2', type: 'voice' },
      { name: 'lounge-vc', type: 'voice' },
      { name: 'staff', type: 'category' },
      { name: 'staff-chat', type: 'text', topic: 'Staff-only' },
    ],
    overwrites: [
      { channel: 'staff', role: '@everyone', deny: ['ViewChannel'] },
      { channel: 'staff', role: 'Moderator', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    ],
  };
}

/** Support: announcements + status, help/tickets, internal staff channels. */
function supportTemplate(): { roles: PlanRole[]; channels: PlanChannel[]; overwrites: PlanOverwrite[] } {
  const supportRole: PlanRole = {
    name: 'Support',
    permissions: [...MEMBER_BASE_PERMISSIONS, ...MODERATOR_EXTRA_PERMISSIONS],
    color: 'teal',
    hoist: true,
  };
  return {
    roles: [memberRole(), supportRole, adminRole()],
    channels: [
      { name: 'announcements', type: 'category' },
      { name: 'announcements', type: 'announcement', topic: 'Service announcements' },
      { name: 'status', type: 'text', topic: 'Incidents and maintenance' },
      { name: 'support', type: 'category' },
      { name: 'general', type: 'text', topic: 'General discussion' },
      { name: 'help', type: 'text', topic: 'Get help here' },
      { name: 'tickets', type: 'text', topic: 'Ticket requests' },
      { name: 'staff', type: 'category' },
      { name: 'staff-chat', type: 'text', topic: 'Internal support chat' },
      { name: 'internal', type: 'text', topic: 'Internal notes' },
    ],
    overwrites: [
      { channel: 'staff', role: '@everyone', deny: ['ViewChannel'] },
      { channel: 'staff', role: 'Support', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    ],
  };
}

const TEMPLATES: Record<string, () => { roles: PlanRole[]; channels: PlanChannel[]; overwrites: PlanOverwrite[] }> = {
  minimal: minimalTemplate,
  community: communityTemplate,
  gaming: gamingTemplate,
  support: supportTemplate,
};

export const SCAFFOLD_TEMPLATES = Object.keys(TEMPLATES);

function validateName(name: string, kind: 'role' | 'channel'): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new ScaffoldError(`${kind} name must be 1-100 characters: "${name}"`);
  }
  if (kind === 'channel' && !/^[a-z0-9-_]+$/.test(trimmed)) {
    throw new ScaffoldError(
      `Channel names may only contain lowercase letters, numbers, hyphens and underscores: "${name}"`
    );
  }
  return trimmed;
}

export function validateScaffoldPlan(
  roles: PlanRole[],
  channels: PlanChannel[],
  overwrites: PlanOverwrite[]
): void {
  const roleNames = new Set<string>();
  for (const role of roles) {
    const name = validateName(role.name, 'role');
    if (roleNames.has(name)) throw new ScaffoldError(`Duplicate role name in template: ${name}`);
    roleNames.add(name);
    if (role.color !== 'default' && !(role.color in ROLE_COLOR_PALETTE)) {
      throw new ScaffoldError(`Unknown role color '${role.color}' in template. Use a palette name or #hex.`);
    }
    try {
      permissionNamesToBits(role.permissions);
    } catch (err) {
      if (err instanceof PermissionError) throw new ScaffoldError(`Role "${name}": ${err.message}`);
      throw err;
    }
  }
  const channelNames = new Set<string>();
  for (const channel of channels) {
    const name = validateName(channel.name, 'channel');
    // Discord permits the same name across different channel types (e.g. a
    // "general" category containing a "general" text channel), so the key is
    // type-qualified.
    const key = `${channel.type}|${name}`;
    if (channelNames.has(key)) throw new ScaffoldError(`Duplicate channel name in template: ${name}`);
    channelNames.add(key);
    if (!(channel.type in CHANNEL_TYPE_LABELS)) {
      throw new ScaffoldError(`Unknown channel type '${channel.type}' in template.`);
    }
  }
  for (const ow of overwrites) {
    if (![...channelNames].some((k) => k.endsWith(`|${ow.channel}`))) {
      throw new ScaffoldError(`Overwrite references unknown channel "${ow.channel}"`);
    }
    if (ow.role !== '@everyone' && !roleNames.has(ow.role)) {
      throw new ScaffoldError(`Overwrite references unknown role "${ow.role}"`);
    }
  }
}

export function buildScaffoldPlan(guildId: string, template: string): ScaffoldPlan {
  const factory = TEMPLATES[template];
  if (!factory) {
    throw new ScaffoldError(`Unknown template '${template}'. Use one of: ${SCAFFOLD_TEMPLATES.join(', ')}.`);
  }
  const { roles, channels, overwrites } = factory();
  validateScaffoldPlan(roles, channels, overwrites);
  return { guildId, template, roles, channels, overwrites };
}

/** Execution order: roles lowest-first (each new role lands above the previous), categories, then channels, then overwrites. */
export function planToSteps(plan: ScaffoldPlan): ScaffoldStep[] {
  const steps: ScaffoldStep[] = [];
  for (const role of plan.roles) {
    steps.push({ kind: 'role', label: `create role @${role.name}`, role });
  }
  for (const channel of plan.channels) {
    if (channel.type === 'category') {
      steps.push({ kind: 'channel', label: `create category "${channel.name}"`, channel });
    }
  }
  for (const channel of plan.channels) {
    if (channel.type === 'category') continue;
    const parentName = findParent(plan, channel.name);
    steps.push({ kind: 'channel', label: `create #${channel.name}`, channel, parentName });
  }
  for (const overwrite of plan.overwrites) {
    steps.push({ kind: 'overwrite', label: `permission overwrite on "${overwrite.channel}" for ${overwrite.role}`, overwrite });
  }
  return steps;
}

function findParent(plan: ScaffoldPlan, channelName: string): string | undefined {
  // Locate the channel itself (a same-named category may appear earlier in the
  // list), then scan backwards for the nearest preceding category.
  const idx = plan.channels.findIndex((c) => c.name === channelName && c.type !== 'category');
  for (let i = idx - 1; i >= 0; i--) {
    if (plan.channels[i]!.type === 'category') return plan.channels[i]!.name;
  }
  return undefined;
}

export function summarizePlan(plan: ScaffoldPlan): string {
  const lines: string[] = [`Template "${plan.template}" for guild \`${plan.guildId}\``];
  lines.push('');
  lines.push('**Roles (bottom → top after creation):**');
  for (const role of plan.roles) {
    const perms = role.permissions.length > 0 ? ` — ${role.permissions.join(', ')}` : '';
    const color = role.color !== 'default' ? ` (${role.color})` : '';
    lines.push(`- @${role.name}${color}${perms}`);
  }
  lines.push('');
  lines.push('**Channels:**');
  for (const channel of plan.channels) {
    if (channel.type === 'category') {
      lines.push(`- **${channel.name}** (category)`);
    } else {
      const parent = findParent(plan, channel.name);
      const under = parent ? ` under **${parent}**` : '';
      const topic = channel.topic ? ` — ${channel.topic}` : '';
      lines.push(`  - #${channel.name} (${channel.type})${under}${topic}`);
    }
  }
  if (plan.overwrites.length > 0) {
    lines.push('');
    lines.push('**Permission overwrites:**');
    for (const ow of plan.overwrites) {
      const allow = ow.allow?.length ? ` allow [${ow.allow.join(', ')}]` : '';
      const deny = ow.deny?.length ? ` deny [${ow.deny.join(', ')}]` : '';
      lines.push(`- "${ow.channel}" for ${ow.role}:${allow}${deny}`);
    }
  }
  lines.push('');
  lines.push('Pass `dry_run: false` to apply. Sovereign control is asserted before the first step.');
  return lines.join('\n');
}