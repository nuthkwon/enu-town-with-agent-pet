import { defineRoom, defineServer, matchMaker, type Server } from '@colyseus/core';
import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';
import { OFFICE_ROOM_NAME } from '@enu/shared';
import type pg from 'pg';
import { isOriginAllowed } from './auth/verifyTicket';
import type { RealtimeEnv } from './env';
import type { Logger } from './logger';
import { OfficeRoom } from './rooms/OfficeRoom';

/** WebSocket frames from browsers are small (chat <= 500 chars); 16 KB leaves headroom. */
export const WS_MAX_PAYLOAD = 16 * 1024;
export const WS_PING_INTERVAL_MS = 5000;

export const rooms = {
  [OFFICE_ROOM_NAME]: defineRoom(OfficeRoom),
};

/**
 * WebSocket transport with an Origin allow-list on the upgrade request (the static onAuth only
 * sees the HTTP matchmake request, so the socket itself is checked here).
 */
export function createTransport(
  env: Pick<RealtimeEnv, 'ALLOWED_ORIGINS'>,
  logger?: Logger,
  extra: TransportOptions = {},
): WebSocketTransport {
  return new WebSocketTransport({
    ...extra,
    pingInterval: WS_PING_INTERVAL_MS,
    pingMaxRetries: 2,
    maxPayload: WS_MAX_PAYLOAD,
    beforeUpgrade: (_req, ctx) => {
      const origin = ctx.headers.get('origin');
      if (!isOriginAllowed(origin, env.ALLOWED_ORIGINS)) {
        logger?.warn({ origin, ip: ctx.ip }, 'websocket upgrade rejected: origin not allowed');
        return new Response(null, { status: 403 });
      }
      return undefined;
    },
  });
}

/**
 * Colyseus reflects any request Origin in CORS headers by default; only allow-listed origins get
 * `Access-Control-Allow-Origin` here (an empty list keeps the permissive default for local dev).
 */
export function installCorsPolicy(allowedOrigins: readonly string[]): void {
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    if (allowedOrigins.length === 0) return { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
    return {
      'Access-Control-Allow-Origin': origin && isOriginAllowed(origin, allowedOrigins) ? origin : 'null',
      Vary: 'Origin',
    };
  };
}

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}
interface RouteApp {
  get(path: string, handler: (req: unknown, res: JsonResponse) => void | Promise<void>): void;
}

/** HTTP routes next to matchmaking. Caddy strips `/colyseus`, so everything is served at root. */
export function registerHttpRoutes(app: RouteApp, deps: { pool: Pick<pg.Pool, 'query'> }): void {
  app.get('/healthz', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await deps.pool.query('select 1');
      res.status(200).json({ ok: true, service: 'realtime' });
    } catch {
      res.status(503).json({ ok: false, service: 'realtime', db: 'unreachable' });
    }
  });
}

export function createRealtimeServer(deps: {
  env: RealtimeEnv;
  logger: Logger;
  pool: Pick<pg.Pool, 'query'>;
}): Server {
  installCorsPolicy(deps.env.ALLOWED_ORIGINS);
  return defineServer({
    rooms,
    transport: createTransport(deps.env, deps.logger),
    express: (app: RouteApp) => registerHttpRoutes(app, { pool: deps.pool }),
    greet: false,
    gracefullyShutdown: true,
  });
}
