import { publicUrl } from './env';
import { HttpError, assertSameOrigin, errorResponse } from './http';

type Params = Record<string, string | string[] | undefined>;

export interface RouteContext<P> {
  params: Promise<P>;
}

/**
 * Wraps a route handler: CSRF origin check for writes, awaited params, and uniform JSON errors
 * (HttpError -> its status; anything else -> 500 without details).
 */
export function route<P extends Params = Record<string, never>>(fn: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    try {
      assertSameOrigin(req, publicUrl());
      const params = (ctx?.params ? await ctx.params : {}) as P;
      return await fn(req, params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function methodNotAllowed(allow: string, message?: string): Response {
  return errorResponse(new HttpError(405, 'method_not_allowed', message, undefined, { allow }));
}
