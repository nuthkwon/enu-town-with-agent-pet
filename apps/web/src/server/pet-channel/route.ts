import { bearerPetChannelToken, resolvePetChannelCaller, type PetChannelCaller } from '@enu/auth';
import { ko } from '@/i18n/ko';
import { authPolicy } from '../auth';
import { getDb } from '../db';
import { HttpError, errorResponse } from '../http';

export type ChannelCaller = PetChannelCaller & { ok: true };

/**
 * Bodies must be JSON: a browser cannot send that cross-origin without a CORS preflight, which ENU Den never
 * answers, so no web page can drive these machine routes from someone's browser.
 */
export function requireJson(req: Request): void {
  const type = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type', ko.errors.jsonRequired);
}

/**
 * Wraps a pet channel route (ADR 0006): the caller is only ever a bearer `edc_` token, never a cookie; errors are
 * the usual JSON. 401 tells the plugin to stop and ask for a new pairing, 403 notice_required to open ENU Den.
 */
export function channelRoute(fn: (req: Request, caller: ChannelCaller) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== 'GET' && req.method !== 'DELETE') requireJson(req);
      const caller = await resolvePetChannelCaller(getDb(), bearerPetChannelToken(req.headers), authPolicy());
      if (!caller.ok) {
        if (caller.reason === 'notice_required')
          throw new HttpError(403, 'notice_required', ko.errors.noticeRequired);
        throw new HttpError(401, caller.reason, ko.errors.channelUnauthorized, undefined, {
          'www-authenticate': `Bearer error="invalid_token", error_description="${caller.reason}"`,
        });
      }
      return await fn(req, caller);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** The first address in X-Forwarded-For (set by Caddy), for the unauthenticated pairing limit. */
export function clientAddress(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
