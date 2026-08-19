import { SparklesIcon } from 'lucide-react';
import { requireAuth } from '@/core/auth/session';
import { listSuggestions } from '@/core/ai/suggestions';
import { Card, EmptyState, PageHeader } from '@/ui/components/primitives';
import { SuggestionList } from './suggestion-list';

export const metadata = { title: 'AI suggestions' };
export const dynamic = 'force-dynamic';

/**
 * The AI review queue.
 *
 * Everything automation wanted to do but was not allowed to do on its own:
 * stage changes it wasn't confident enough about, values that would have
 * overwritten existing data, terminal moves like "mark this client lost".
 * A person accepts or rejects, and the same service the manual UI uses runs
 * the action — there is no separate automation code path.
 */
export default async function SuggestionsPage() {
  await requireAuth();
  const suggestions = await listSuggestions({ take: 100 });

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI suggestions"
        description="Actions the CRM proposed but did not take on its own. Accepting one runs exactly the same operation you would have run by hand."
      />

      {suggestions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SparklesIcon className="size-7" />}
            title="Nothing waiting"
            description="When AI is unsure, or when an action is too consequential to automate, it will appear here."
          />
        </Card>
      ) : (
        <SuggestionList
          suggestions={suggestions.map((s) => ({
            id: s.id,
            kind: s.kind,
            confidence: s.confidence,
            rationale: s.rationale,
            payload: s.payload as Record<string, unknown>,
            createdAt: s.createdAt.toISOString(),
            clientId: s.clientId,
            clientName: s.client.displayName,
            stageName: s.client.stage.name,
            stageColor: s.client.stage.color,
            messageBody: s.message?.body ?? null,
            documentName: s.document?.filename ?? null,
          }))}
        />
      )}
    </div>
  );
}
