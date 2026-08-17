import { z } from 'zod';

export const guildIdSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Discord snowflake ID of the guild (right-click the server icon > Copy Server ID).');

export const userIdSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Discord snowflake ID of the user.');

export const channelIdSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Discord snowflake ID of the channel.');

export const roleIdSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Discord snowflake ID of the role.');

export const messageIdSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Discord snowflake ID of the message.');

export const reasonSchema = z
  .string()
  .max(512)
  .optional()
  .describe('Audit-log reason stamped on the action (appears in the server audit log).');

export const dryRunSchema = z
  .boolean()
  .default(true)
  .describe('When true (default), previews the effect and returns the exact API payload without executing. Set false to actually perform the operation.');

export const colorSchema = z
  .string()
  .optional()
  .describe('Role color: #RRGGBB (e.g. #e74c3c), 0xRRGGBB, decimal integer, or a named color (red, green, blue, purple, gold, blurple, white, black, ...).');

export const permissionsSchema = z
  .array(z.string())
  .optional()
  .describe('Discord permission names (e.g. ["ManageRoles", "KickMembers", "ViewChannel"]). Use discord_resolve_permissions for the full list.');

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .describe('Number of results to return (1-100).');

export const offsetSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe('Pagination offset (use the previous response\'s next_offset).');

export const afterSchema = z
  .string()
  .optional()
  .describe('Snowflake ID cursor: return results after this ID (higher-ID = newer).');

export const beforeSchema = z
  .string()
  .optional()
  .describe('Snowflake ID cursor: return results before this ID.');