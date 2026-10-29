import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { adminSeats, adminUsers, adoption } from '@/server/queries/admin';
import { AdminClient } from './AdminClient';

export const metadata: Metadata = { title: ko.admin.title };

export default async function AdminPage() {
  const viewer = await requirePageViewer('/admin');
  if (!viewer.isAdmin) notFound();
  const db = getDb();
  const [seats, users] = await Promise.all([adminSeats(db), adminUsers(db, viewer)]);
  return <AdminClient seats={seats} users={users} counts={adoption(users)} />;
}
