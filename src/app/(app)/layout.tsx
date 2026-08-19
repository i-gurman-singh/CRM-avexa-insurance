import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { auth } from '@/core/auth/session';
import { countPendingSuggestions } from '@/core/ai/suggestions';
import { unreadNotificationCount } from '@/core/notifications/service';
import { getSetting } from '@/core/settings/service';
import { Sidebar, TopBar, type NavCounts } from '@/ui/components/nav';
import { endOfDay } from '@/lib/utils';

/**
 * Authenticated shell.
 *
 * Everything under (app) requires a session. The counts shown in the sidebar
 * are computed here, once per navigation, rather than by each page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await auth();
  if (!user) redirect('/login');

  const dayEnd = endOfDay(new Date());

  const [unreadConversations, tasksDue, followUpsDue, suggestions, notifications, brokerageName] =
    await Promise.all([
      db.conversation.count({ where: { unreadCount: { gt: 0 }, state: { not: 'CLOSED' } } }),
      db.task.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lte: dayEnd }, assignedUserId: user.id },
      }),
      db.followUp.count({ where: { status: 'SCHEDULED', dueAt: { lte: dayEnd }, assignedUserId: user.id } }),
      countPendingSuggestions(),
      unreadNotificationCount(user.id),
      getSetting('general.brokerageName'),
    ]);

  const counts: NavCounts = {
    unreadConversations,
    tasksDue,
    followUpsDue,
    suggestions,
    notifications,
  };

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <div className="sticky top-0 h-dvh overflow-y-auto scrollbar-thin">
          <Sidebar counts={counts} brokerageName={brokerageName} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} counts={counts} brokerageName={brokerageName} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
