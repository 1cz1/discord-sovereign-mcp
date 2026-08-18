import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { DiscordClient } from '../client/discordClient.js';
import type { ControlService } from '../services/controlService.js';
import { describeDiscordError } from '../client/errors.js';
import { jsonSafe } from '../utils/format.js';

export interface ToolContext {
  client: DiscordClient;
  control: ControlService;
}

export interface MCPResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type ToolInput = Record<string, unknown>;

export interface RegisteredTool {
  /** snake_case, service-prefixed, max 64 chars (e.g. discord_create_role). */
  name: string;
  /** Short display title (max 64 chars). */
  title: string;
  /** Prose description for the LLM: what it does, when to use it, example params. */
  description: string;
  /** zod object schema; use shared schemas from ./sharedSchemas.ts. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** Executes the tool. Return ok(...) or fail(...): never throw. */
  handle: (params: ToolInput, ctx: ToolContext) => Promise<MCPResult>;
}

export function ok(text: string, structured?: Record<string, unknown>): MCPResult {
  const result: MCPResult = { content: [{ type: 'text', text }] };
  if (structured) result.structuredContent = jsonSafe(structured) as Record<string, unknown>;
  return result;
}

export function fail(text: string, structured?: Record<string, unknown>): MCPResult {
  const result: MCPResult = {
    content: [{ type: 'text', text: `❌ ${text}` }],
    isError: true,
  };
  if (structured) result.structuredContent = jsonSafe(structured) as Record<string, unknown>;
  return result;
}

export function installTools(server: McpServer, ctx: ToolContext, tools: RegisteredTool[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        outputSchema: z.object({
          content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
          isError: z.boolean().optional(),
          structuredContent: z.record(z.unknown()).optional(),
        }),
      },
      async (params) => {
        try {
          return (await tool.handle(params as ToolInput, ctx)) as unknown as CallToolResult;
        } catch (err) {
          return fail(describeDiscordError(err).message) as unknown as CallToolResult;
        }
      }
    );
  }
}