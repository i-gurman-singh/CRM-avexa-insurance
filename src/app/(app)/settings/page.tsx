import { can } from '@/lib/rbac';
import { env } from '@/lib/env';
import { requireAuth } from '@/core/auth/session';
import { listSettings } from '@/core/settings/service';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/ui/components/primitives';
import { SettingsEditor } from './settings-editor';

export const metadata = { title: 'Automation settings' };
export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, { title: string; description: string }> = {
  automation: {
    title: 'Automation',
    description: 'What the CRM does on its own when a message comes in.',
  },
  ai: {
    title: 'AI',
    description:
      'How much the CRM trusts the model. Below a threshold, an action becomes a suggestion for a person instead of happening automatically.',
  },
  followups: {
    title: 'Follow-ups',
    description: 'When the CRM decides someone needs chasing.',
  },
  pipeline: { title: 'Pipeline', description: 'Stage timing and automatic movement.' },
  notifications: { title: 'Notifications', description: 'Who gets told, and how often.' },
  general: { title: 'General', description: 'Brokerage details and defaults.' },
};

export default async function AutomationSettingsPage() {
  const user = await requireAuth();
  const canManage = can(
    { role: user.role, permissionOverrides: user.permissionOverrides },
    'settings.manage',
  );

  const settings = await listSettings();
  const byCategory = settings.reduce<Record<string, typeof settings>>((acc, setting) => {
    (acc[setting.category] ||= []).push(setting);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Outbound automation</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The master switch for messages the CRM sends without a person pressing send. It lives
              in the server environment, not in this screen, so it cannot be flipped by accident.
            </p>
          </div>
          <Badge tone={env.AUTOMATION_OUTBOUND_ENABLED ? 'success' : 'warning'}>
            {env.AUTOMATION_OUTBOUND_ENABLED ? 'Enabled' : 'Off — drafts only'}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            While this is off, every automated message the CRM would have sent becomes a task
            instead, with the text ready to review. Turn it on by setting{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px]">
              AUTOMATION_OUTBOUND_ENABLED=true
            </code>{' '}
            and restarting the app.
          </p>
        </CardContent>
      </Card>

      {Object.entries(byCategory).map(([category, items]) => (
        <Card key={category}>
          <CardHeader>
            <div>
              <CardTitle>{CATEGORY_LABELS[category]?.title ?? category}</CardTitle>
              {CATEGORY_LABELS[category] ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {CATEGORY_LABELS[category].description}
                </p>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <SettingsEditor
              canManage={canManage}
              settings={items.map((s) => ({
                key: s.key,
                label: s.label,
                description: s.description,
                type: s.type,
                value: s.value,
                isOverridden: s.isOverridden,
              }))}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
