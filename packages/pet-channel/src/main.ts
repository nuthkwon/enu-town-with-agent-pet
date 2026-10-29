import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { PetChannel } from './channel';
import { runCli } from './cli';
import { PetChannelClient } from './client';
import { readConfig, type ChannelConfig } from './config';
import { loadCredentials } from './credentials';
import { createChannelServer, emitTo } from './server';

/**
 * `den-channel.mjs`: with a command (`pair`, `status`, `unpair`) it is the terminal CLI behind `enu-pet`;
 * without one it is the stdio MCP server Claude Code spawns. In server mode stdout carries only MCP and stderr
 * only short codes.
 */

const SHUTDOWN_GRACE_MS = 1_000;

async function serve(config: ChannelConfig): Promise<void> {
  if (!config.active) {
    // Not a pet session: no tools, no network, the credentials file is never opened.
    await createChannelServer(null).connect(new StdioServerTransport());
    return;
  }
  const loadClient = () => {
    const creds = loadCredentials(config.credentialsPath, config.baseUrl);
    return creds ? new PetChannelClient(config.baseUrl, creds.token) : null;
  };
  let emit: ReturnType<typeof emitTo> = async () => undefined;
  const channel = new PetChannel({
    client: loadClient(),
    reloadClient: loadClient,
    emit: (event) => emit(event),
    log: (code) => process.stderr.write(`[enu-den-channel] ${code}\n`),
  });
  const server = createChannelServer(channel);
  emit = emitTo(server);
  // Nothing is pushed before Claude Code is listening.
  server.server.oninitialized = () => void channel.run();

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    channel.stop();
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
    void server.close();
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sig, shutdown);
  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let config: ChannelConfig;
  try {
    config = readConfig();
  } catch {
    process.stderr.write('ENU_DEN_URL must be https (http only for localhost)\n');
    process.exit(2);
  }
  if (args.length > 0) {
    const code = await runCli(args, config, {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    });
    process.exit(code);
  }
  await serve(config);
}

void main();
