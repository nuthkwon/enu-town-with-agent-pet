import * as z from 'zod';

/** Claims of the short-lived HS256 ticket the browser presents to the realtime server. */
export const realtimeTicketClaims = z.object({
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number(),
});
export type RealtimeTicketClaims = z.infer<typeof realtimeTicketClaims>;
