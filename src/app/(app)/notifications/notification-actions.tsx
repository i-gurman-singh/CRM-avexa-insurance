'use client';

import { useTransition, type ReactNode } from 'react';
import { CheckCheckIcon } from 'lucide-react';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/work';
import { Button } from '@/ui/components/primitives';

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      onClick={() => startTransition(async () => void (await markAllNotificationsReadAction()))}
    >
      <CheckCheckIcon className="size-4" />
      Mark all read
    </Button>
  );
}

/** Marks a notification read when it is clicked or focused. */
export function NotificationRow({
  id,
  unread,
  children,
}: {
  id: string;
  unread: boolean;
  children: ReactNode;
}) {
  const [, startTransition] = useTransition();

  if (!unread) return <>{children}</>;

  return (
    <div
      onClick={() => startTransition(async () => void (await markNotificationReadAction(id)))}
      className="cursor-pointer"
    >
      {children}
    </div>
  );
}
