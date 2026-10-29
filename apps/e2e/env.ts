import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://enu:enu@127.0.0.1:5432/enu_town_e2e';
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const RT_PORT = Number(process.env.E2E_RT_PORT ?? 2667);
export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const TICKET_SECRET = 'e2e-ticket-secret-0123456789abcdef0123456789';
export const DOMAIN = 'enu-tech.co.kr';
/** Seeded demo accounts (packages/db/seed/dev.ts), one per desk. */
export const devEmail = (deskId: string) => `dev.${deskId.toLowerCase()}@${DOMAIN}`;
