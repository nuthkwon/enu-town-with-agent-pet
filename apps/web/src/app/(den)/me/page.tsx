import { AVATAR_SWATCHES } from '@enu/sprites';
import type { Metadata } from 'next';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { listClaudeLinks } from '@/server/queries/links';
import { listLogs } from '@/server/queries/logs';
import { buildMeDto } from '@/server/queries/me';
import { listTodos } from '@/server/queries/todos';
import { MeClient, type MeTab } from './MeClient';

export const metadata: Metadata = { title: ko.me.title };

const TABS: readonly MeTab[] = ['link', 'logs', 'todos', 'settings', 'profile', 'export'];

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePageViewer('/me');
  const sp = await searchParams;
  const db = getDb();
  const [me, links, logs, todos] = await Promise.all([
    buildMeDto(db, viewer),
    listClaudeLinks(db, viewer.userId),
    listLogs(db, viewer, viewer.userId, null, 10),
    listTodos(db, viewer.userId),
  ]);
  const focusLog = typeof sp.log === 'string' ? sp.log : null;
  const tabParam = typeof sp.tab === 'string' ? (sp.tab as MeTab) : null;
  const tab: MeTab = tabParam && TABS.includes(tabParam) ? tabParam : focusLog ? 'logs' : 'link';
  return (
    <MeClient
      me={me}
      links={links}
      logs={logs}
      todos={todos}
      swatches={AVATAR_SWATCHES}
      initialTab={tab}
      focusLogId={focusLog}
    />
  );
}
