/**
 * Local demo data (NEVER in production): one dev user per seat with profiles, Claude links,
 * sample Claude-style work logs, to-dos, pet nudges and chat. Idempotent: replaces dev.* users.
 * Dev users sign in through the dev-login flow (DEV_LOGIN_ENABLED=1) with their dev email.
 */
import {
  APP_TIMEZONE_DEFAULT,
  ALLOWED_GOOGLE_HD_DEFAULT,
  PRIVACY_NOTICE_VERSION,
  addLocalDays,
  atLocalTime,
  localDateKey,
} from '@enu/shared';
import { like, sql } from 'drizzle-orm';
import { createDb } from '../src/client';
import { newId, newOpaqueId } from '../src/ids';
import { insertDefaultPet } from '../src/pets';
import {
  chatMessages,
  claudeLinks,
  desks,
  petNudges,
  privacyConsents,
  profiles,
  todos,
  workLogs,
} from '../src/schema/app';
import { user } from '../src/schema/auth';
import { loadRoster } from './roster';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to seed demo data in production');
  process.exit(1);
}

const TZ = process.env.APP_TIMEZONE ?? APP_TIMEZONE_DEFAULT;
const HD = process.env.ALLOWED_GOOGLE_HD ?? ALLOWED_GOOGLE_HD_DEFAULT;
const url = process.env.DATABASE_URL ?? 'postgres://enu:enu@127.0.0.1:5432/enu_den_dev';
const { db, close } = createDb(url, { max: 2 });
const { roster } = loadRoster();

export const devEmail = (deskId: string) => `dev.${deskId.toLowerCase()}@${HD}`;

const SAMPLES = [
  {
    summary:
      '고객사 A 견적서 초안을 검토하고 수정 요청 사항을 정리했습니다. 오후에는 배포 체크리스트를 업데이트했습니다.',
    tasks: [
      { title: '고객사 A 견적서 검토', status: 'done' },
      { title: '배포 체크리스트 업데이트', status: 'in_progress', ref: 'ENU-142' },
    ],
    blockers: [],
    chat: '견적 구성 방식과 일정 산정 근거를 Claude와 정리했습니다.',
  },
  {
    summary: '센서 데이터 수집 모듈의 버그를 재현하고 원인을 좁혔습니다. 재시도 로직 PR을 올렸습니다.',
    tasks: [
      { title: '수집 모듈 버그 재현', status: 'done', ref: 'ENU-201' },
      { title: '재시도 로직 PR 리뷰 대응', status: 'in_progress' },
    ],
    blockers: ['테스트 장비 예약 필요'],
    chat: '재시도 백오프 전략과 테스트 케이스를 Claude와 검토했습니다.',
  },
  {
    summary: '주간 회의 자료를 준비하고 지난 분기 지표를 요약했습니다.',
    tasks: [
      { title: '주간 회의 자료 준비', status: 'done' },
      { title: '분기 지표 요약', status: 'planned' },
    ],
    blockers: [],
    chat: '지표 시각화 방법을 Claude와 논의했습니다.',
  },
  {
    summary: '신규 기능 요구사항 문서를 작성하고 화면 흐름을 검토했습니다.',
    tasks: [
      { title: '요구사항 문서 작성', status: 'in_progress' },
      { title: '화면 흐름 검토', status: 'done' },
    ],
    blockers: [],
    chat: '사용자 시나리오 초안을 Claude와 다듬었습니다.',
  },
] as const;

const NUDGES = [
  '14시 회의 전에 자료 한 번 더 확인해 볼까요?',
  '오늘 PR 리뷰 하나만 먼저 끝내 볼까요?',
  '점심 전에 견적서 회신 보내 두면 좋겠어요!',
  '잠깐 스트레칭하고 다시 집중해 봐요 ✨',
];

const now = new Date();
const today = localDateKey(now, TZ);
const yesterday = localDateKey(addLocalDays(now, TZ, -1), TZ);

await db.transaction(async (tx) => {
  // Remove previous dev users (cascades to their rows) and free their desks.
  await tx.delete(user).where(like(user.email, `dev.%@${HD}`));

  const ids: string[] = [];
  for (const [i, seat] of roster.seats.entries()) {
    const id = newId();
    ids.push(id);
    const linked = i % 7 !== 3; // two people not linked yet
    const stale = i === 5;
    await tx.insert(user).values({
      id,
      name: seat.name,
      email: devEmail(seat.deskId),
      emailVerified: true,
      hd: HD,
      status: 'active',
      role: i === 0 ? 'admin' : 'member',
    });
    await tx.insert(profiles).values({
      userId: id,
      displayName: seat.name,
      avatar: seat.avatar,
      team: seat.team ?? null,
      title: seat.title ?? null,
      roleNote: seat.role ?? null,
      defaultChatSummaryVisibility: i % 2 === 0 ? 'company' : 'private',
      // Demo users share their Claude-derived activity and show up when they open the town.
      shareActivity: true,
      showLive: true,
      linkState: linked ? (stale ? 'stale' : 'linked') : 'not_linked',
      lastWorkLogAt: linked ? (stale ? atLocalTime(addLocalDays(now, TZ, -6), TZ, '17:00') : now) : null,
      onboardingCompletedAt: now,
      timezone: TZ,
    });
    await insertDefaultPet(tx, { userId: id, name: seat.pet.name, species: seat.pet.species });
    await tx.insert(privacyConsents).values([
      { id: newId(), userId: id, noticeVersion: PRIVACY_NOTICE_VERSION, scope: 'service' },
      { id: newId(), userId: id, noticeVersion: PRIVACY_NOTICE_VERSION, scope: 'activity_sharing' },
    ]);
    await tx
      .insert(desks)
      .values({
        deskId: seat.deskId,
        labelName: seat.name,
        avatar: seat.avatar,
        petSpecies: seat.pet.species,
        petName: seat.pet.name,
        team: seat.team ?? null,
        title: seat.title ?? null,
        roleNote: seat.role ?? null,
        userId: id,
      })
      .onConflictDoUpdate({ target: desks.deskId, set: { userId: id, updatedAt: sql`now()` } });

    if (!linked) continue;
    await tx.insert(claudeLinks).values({
      id: newId(),
      userId: id,
      clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
      clientName: 'Claude',
      clientKind: 'claude_ai',
      redirectHost: 'claude.ai',
      consentedAt: addLocalDays(now, TZ, -10),
      lastToolCallAt: now,
      toolCallCount: 12,
    });
    const sample = SAMPLES[i % SAMPLES.length]!;
    for (const [day, when] of [
      [yesterday, atLocalTime(addLocalDays(now, TZ, -1), TZ, '17:30')],
      ...(stale ? [] : [[today, now] as const]),
    ] as const) {
      await tx.insert(workLogs).values({
        id: newOpaqueId(),
        userId: id,
        periodKey: day,
        periodStart: atLocalTime(when, TZ, '09:00'),
        periodEnd: when,
        summary: sample.summary,
        tasks: sample.tasks.map((t) => ({ ...t })),
        blockers: [...sample.blockers],
        claudeChatSummary: sample.chat,
        visibility: i === 8 ? 'private' : 'company',
        chatSummaryVisibility: i % 2 === 0 ? 'company' : 'private',
        source: 'cowork_scheduled',
        oauthClientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
        claudeWrittenAt: when,
      });
    }
    const todoId = newId();
    await tx.insert(todos).values({
      id: todoId,
      userId: id,
      externalRef: `demo:todo:${seat.deskId}`,
      title: sample.tasks[1]?.title ?? '오늘 할 일 정리',
      dueAt: new Date(now.getTime() + (40 + i * 7) * 60_000),
      priority: 2,
    });
    await tx.insert(petNudges).values({
      id: newId(),
      userId: id,
      text: NUDGES[i % NUDGES.length]!,
      kind: 'reminder',
      todoId,
      priority: i % 4 === 0 ? 1 : 2,
      showAfter: now,
      expiresAt: new Date(now.getTime() + 8 * 3600_000),
    });
  }

  // A little chat history.
  const [a, b, c] = ids;
  if (a && b && c) {
    const t0 = now.getTime() - 3600_000;
    const room = [
      [a, '오늘 점심 같이 드실 분 계신가요? 🍜'],
      [b, '저요! 12시에 입구에서 봬요'],
      [c, '회의실 3시부터 쓸게요'],
    ] as const;
    for (const [k, [sender, body]] of room.entries()) {
      await tx.insert(chatMessages).values({
        id: newId(),
        kind: 'room',
        senderId: sender,
        body,
        clientMsgId: `demo-room-${k}`,
        createdAt: new Date(t0 + k * 60_000),
      });
    }
    const [low, high] = [a, b].sort() as [string, string];
    const dms = [
      [a, '견적서 초안 공유드렸어요. 확인 부탁드려요!'],
      [b, '네 오후에 보고 코멘트 남길게요 👍'],
    ] as const;
    for (const [k, [sender, body]] of dms.entries()) {
      await tx.insert(chatMessages).values({
        id: newId(),
        kind: 'dm',
        senderId: sender,
        dmLow: low,
        dmHigh: high,
        body,
        clientMsgId: `demo-dm-${k}`,
        createdAt: new Date(t0 + (5 + k) * 60_000),
      });
    }
  }
});

console.log(`seeded ${roster.seats.length} demo users (dev.<desk>@${HD})`);
await close();
