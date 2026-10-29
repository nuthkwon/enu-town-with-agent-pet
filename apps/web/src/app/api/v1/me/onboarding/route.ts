import { onboardingSubmit } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody } from '@/server/http';
import { buildMeDto } from '@/server/queries/me';
import { submitOnboarding } from '@/server/queries/onboarding';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/me/onboarding (onboardingSubmit) -> MeDto. Requires the current notice version. */
export const POST = route(async (req) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, onboardingSubmit);
  await submitOnboarding(getDb(), viewer, body);
  return json(await buildMeDto(getDb(), viewer));
});
