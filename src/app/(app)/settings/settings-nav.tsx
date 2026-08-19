'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/settings', label: 'Automation & AI', exact: true },
  { href: '/settings/pipeline', label: 'Pipeline stages' },
  { href: '/settings/lists', label: 'Lists & lookups' },
  { href: '/settings/documents', label: 'Document types' },
  { href: '/settings/fields', label: 'Custom fields' },
  { href: '/settings/users', label: 'Users & permissions', requiresUsers: true },
  { href: '/settings/jobs', label: 'Background jobs' },
  { href: '/settings/audit', label: 'Audit log' },
];

export function SettingsNav({ canManageUsers }: { canManageUsers: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="lg:w-52 lg:shrink-0" aria-label="Settings sections">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible scrollbar-thin">
        {ITEMS.filter((i) => !i.requiresUsers || canManageUsers).map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
                  active
                    ? 'bg-primary-subtle font-medium text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
