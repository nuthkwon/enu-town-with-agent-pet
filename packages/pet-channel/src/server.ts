import { channelReplyToolInput, channelStatusToolInput } from '@enu/shared';
import { McpServer } from '@modelcontextprotocol/server';
import type { ChannelEvent, PetChannel } from './channel';
import { CHANNEL_INSTRUCTIONS, INACTIVE_INSTRUCTIONS, TOOL_DESCRIPTIONS } from './instructions';
import { PLUGIN_VERSION } from './version';

export const SERVER_NAME = 'den';
export const CHANNEL_NOTIFICATION = 'notifications/claude/channel';

/**
 * The stdio MCP server Claude Code spawns. Active (ENU_DEN_PET=1) it declares only the `claude/channel`
 * capability (never the permission relay) and the tools `reply` and `status`; inactive it declares nothing and
 * has no tools. There is deliberately no pairing tool: only a person in a terminal pairs (ADR 0006 §3).
 */
export function createChannelServer(channel: PetChannel | null): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: PLUGIN_VERSION },
    channel
      ? {
          capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
          instructions: CHANNEL_INSTRUCTIONS,
        }
      : { instructions: INACTIVE_INSTRUCTIONS },
  );
  if (!channel) return server;

  server.registerTool(
    'reply',
    {
      title: 'Reply as the pet',
      description: TOOL_DESCRIPTIONS.reply,
      inputSchema: channelReplyToolInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) => channel.reply(args),
  );
  server.registerTool(
    'status',
    {
      title: 'ENU Den pet channel status',
      description: TOOL_DESCRIPTIONS.status,
      inputSchema: channelStatusToolInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => channel.status(),
  );
  return server;
}

/** Sends one channel event into the session. */
export function emitTo(server: McpServer): (event: ChannelEvent) => Promise<void> {
  return (event) => server.server.notification({ method: CHANNEL_NOTIFICATION, params: event });
}
