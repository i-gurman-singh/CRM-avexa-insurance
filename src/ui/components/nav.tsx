'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3Icon,
  BellIcon,
  CheckSquareIcon,
  ClockIcon,
  FileTextIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MessageSquareIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, Badge, Button } from './primitives';

/**
 * Application shell: sidebar, top bar, global search.
 *
 * Purely presentational — counts and the current user are passed in from the
 * server layout. Keeping it dumb means the navigation can be redesigned
 * without touching any query.
 */

export interface NavCounts {
  unreadConversations: number;
  tasksDue: number;
  followUpsDue: number;
  suggestions: number;
  notifications: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
  exact?: boolean;
  badge?: keyof NavCounts;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboardIcon, exact: true },
  { href: '/conversations', label: 'Conversations', icon: MessageSquareIcon, badge: 'unreadConversations' },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanIcon },
  { href: '/clients', label: 'Clients', icon: UsersIcon },
  { href: '/tasks', label: 'Tasks', icon: CheckSquareIcon, badge: 'tasksDue' },
  { href: '/follow-ups', label: 'Follow-ups', icon: ClockIcon, badge: 'followUpsDue' },
  { href: '/documents', label: 'Documents', icon: FileTextIcon },
  { href: '/suggestions', label: 'AI suggestions', icon: SparklesIcon, badge: 'suggestions' },
  { href: '/policies', label: 'Policies', icon: ShieldIcon },
  { href: '/analytics', label: 'Analytics', icon: BarChart3Icon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar({
  counts,
  brokerageName,
  onNavigate,
}: {
  counts: NavCounts;
  brokerageName: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <div className="mb-3 flex items-center gap-2 px-2 py-1">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          {brokerageName.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-sm font-semibold">{brokerageName}</span>
      </div>

      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const count = item.badge ? counts[item.badge] : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-primary-subtle font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {count > 0 ? (
              <Badge tone={active ? 'primary' : 'neutral'} className="px-1.5 py-0 text-[10px]">
                {count > 99 ? '99+' : count}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function TopBar({
  user,
  counts,
  brokerageName,
}: {
  user: { name: string; email: string; role: string; avatarUrl?: string | null };
  counts: NavCounts;
  brokerageName: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <MenuIcon className="size-4" />
        </Button>

        <GlobalSearch />

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/notifications"
            className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            aria-label={`Notifications${counts.notifications ? `, ${counts.notifications} unread` : ''}`}
          >
            <BellIcon className="size-4" />
            {counts.notifications > 0 ? (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-critical" />
            ) : null}
          </Link>

          <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs font-medium">{user.name}</p>
              <p className="truncate text-[10px] text-muted-foreground capitalize">
                {user.role.toLowerCase()}
              </p>
            </div>
            <form action="/api/auth/signout" method="post">
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
                <LogOutIcon className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-surface shadow-[var(--shadow-overlay)]">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close">
                <XIcon className="size-4" />
              </Button>
            </div>
            <Sidebar counts={counts} brokerageName={brokerageName} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function GlobalSearch() {
  const [value, setValue] = useState('');

  return (
    <form action="/clients" className="relative w-full max-w-md">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search clients, phone, VIN, licence, policy…"
        aria-label="Search"
        className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      />
    </form>
  );
}
