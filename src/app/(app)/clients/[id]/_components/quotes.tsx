'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2Icon, PlusIcon, SendIcon, Trash2Icon, TrophyIcon } from 'lucide-react';
import { formatCurrency, toNumber } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import {
  createQuoteAction,
  deleteQuoteAction,
  markQuoteSentAction,
  selectQuoteAction,
} from '@/server/actions/quotes';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/ui/components/primitives';

/**
 * Quote comparison.
 *
 * A client is usually quoted by three or four companies at once, and the
 * decision is made by looking at them side by side. The cheapest monthly
 * premium is highlighted, and the one the client actually chose is marked —
 * that selection is what feeds the "which company wins most often" analytics.
 *
 * Selecting a quote is a human-only action; automation can never do it.
 */

export interface QuoteRow {
  id: string;
  company: string;
  companyId: string;
  statusName: string;
  statusColor: string;
  monthlyPremium: number | null;
  annualPremium: number | null;
  coverageType: string | null;
  liabilityLimit: number | null;
  collisionDeductible: number | null;
  telematics: boolean;
  isSelected: boolean;
  sentToClientAt: string | null;
  quoteDate: string;
  notes: string | null;
}

export function QuotesPanel({
  clientId,
  quotes,
  companies,
  statuses,
  canEdit,
  canSelect,
}: {
  clientId: string;
  quotes: QuoteRow[];
  companies: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; name: string }>;
  canEdit: boolean;
  canSelect: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const monthlies = quotes.map((q) => q.monthlyPremium).filter((n): n is number => n !== null);
  const cheapest = monthlies.length ? Math.min(...monthlies) : null;
  const selected = quotes.find((q) => q.isSelected);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Quotes</CardTitle>
            {quotes.length > 1 && cheapest !== null ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {quotes.length} companies compared · lowest {formatCurrency(cheapest)}/month
                {selected ? ` · client chose ${selected.company}` : ''}
              </p>
            ) : null}
          </div>
          {canEdit ? (
            <Button size="sm" variant={adding ? 'ghost' : 'outline'} onClick={() => setAdding(!adding)}>
              <PlusIcon className="size-3.5" />
              {adding ? 'Cancel' : 'Add quote'}
            </Button>
          ) : null}
        </CardHeader>

        {adding ? (
          <CardContent className="border-t border-border pt-4">
            <form
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                setError(null);
                startTransition(async () => {
                  const result = await createQuoteAction(clientId, {
                    insuranceCompanyId: data.get('insuranceCompanyId'),
                    statusId: data.get('statusId') || undefined,
                    monthlyPremium: data.get('monthlyPremium') || null,
                    annualPremium: data.get('annualPremium') || null,
                    coverageType: data.get('coverageType') || null,
                    liabilityLimit: data.get('liabilityLimit') || null,
                    collisionDeductible: data.get('collisionDeductible') || null,
                    telematics: data.get('telematics') === 'on',
                    notes: data.get('notes') || null,
                  });
                  if (result.ok) setAdding(false);
                  else setError(result.error);
                });
              }}
            >
              <Field label="Company" htmlFor="q-company" required>
                <Select id="q-company" name="insuranceCompanyId" required>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Status" htmlFor="q-status">
                <Select id="q-status" name="statusId">
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Monthly premium" htmlFor="q-monthly">
                <Input id="q-monthly" name="monthlyPremium" type="number" step="0.01" placeholder="475.00" />
              </Field>

              <Field label="Annual premium" htmlFor="q-annual" hint="Filled in from monthly if blank">
                <Input id="q-annual" name="annualPremium" type="number" step="0.01" />
              </Field>

              <Field label="Coverage" htmlFor="q-coverage">
                <Select id="q-coverage" name="coverageType">
                  <option value="">—</option>
                  <option value="liability_only">Liability only</option>
                  <option value="standard">Standard</option>
                  <option value="full">Full</option>
                </Select>
              </Field>

              <Field label="Liability limit" htmlFor="q-liability">
                <Input id="q-liability" name="liabilityLimit" type="number" placeholder="2000000" />
              </Field>

              <Field label="Collision deductible" htmlFor="q-collision">
                <Input id="q-collision" name="collisionDeductible" type="number" placeholder="1000" />
              </Field>

              <Field label="Telematics" htmlFor="q-telematics">
                <label className="flex h-9.5 items-center gap-2 text-sm">
                  <input id="q-telematics" name="telematics" type="checkbox" className="size-4" />
                  Enrolled
                </label>
              </Field>

              <Field label="Notes" htmlFor="q-notes" className="col-span-2 sm:col-span-4">
                <Input id="q-notes" name="notes" placeholder="Anything worth remembering about this quote" />
              </Field>

              {error ? (
                <p className="col-span-2 rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical sm:col-span-4">
                  {error}
                </p>
              ) : null}

              <div className="col-span-2 sm:col-span-4">
                <Button type="submit" size="sm" loading={pending}>
                  Save quote
                </Button>
              </div>
            </form>
          </CardContent>
        ) : null}

        <CardContent className="p-0">
          {quotes.length === 0 ? (
            <EmptyState
              title="No quotes yet"
              description="Add a quote for each company you approach so they can be compared side by side."
            />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Company</TH>
                  <TH>Monthly</TH>
                  <TH className="hidden sm:table-cell">Annual</TH>
                  <TH className="hidden md:table-cell">Coverage</TH>
                  <TH>Status</TH>
                  <TH className="hidden lg:table-cell">Quoted</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {quotes.map((quote) => {
                  const isCheapest = cheapest !== null && quote.monthlyPremium === cheapest;
                  return (
                    <TR key={quote.id} className={quote.isSelected ? 'bg-success-subtle/40' : undefined}>
                      <TD>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{quote.company}</span>
                          {quote.isSelected ? (
                            <Badge tone="success" className="gap-1 px-1.5 py-0 text-[10px]">
                              <CheckCircle2Icon className="size-2.5" aria-hidden />
                              Selected
                            </Badge>
                          ) : null}
                        </span>
                      </TD>
                      <TD>
                        <span className="flex items-center gap-1.5 font-medium tabular-nums">
                          {formatCurrency(quote.monthlyPremium)}
                          {isCheapest && quotes.length > 1 ? (
                            <TrophyIcon className="size-3.5 text-success" aria-label="Lowest premium" />
                          ) : null}
                        </span>
                      </TD>
                      <TD className="hidden sm:table-cell tabular-nums text-muted-foreground">
                        {formatCurrency(quote.annualPremium)}
                      </TD>
                      <TD className="hidden md:table-cell text-xs text-muted-foreground">
                        {quote.coverageType?.replace(/_/g, ' ') ?? '—'}
                        {quote.telematics ? ' · telematics' : ''}
                      </TD>
                      <TD>
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ backgroundColor: `${quote.statusColor}1a`, color: quote.statusColor }}
                        >
                          {quote.statusName}
                        </span>
                      </TD>
                      <TD className="hidden lg:table-cell text-xs text-muted-foreground">
                        {formatDate(quote.quoteDate)}
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && !quote.sentToClientAt ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Mark as sent to the client"
                              loading={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await markQuoteSentAction(clientId, quote.id);
                                  if (!result.ok) setError(result.error);
                                })
                              }
                            >
                              <SendIcon className="size-3.5" />
                              Sent
                            </Button>
                          ) : null}

                          {canSelect && !quote.isSelected ? (
                            <Button
                              variant="outline"
                              size="sm"
                              loading={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await selectQuoteAction(clientId, quote.id);
                                  if (!result.ok) setError(result.error);
                                })
                              }
                            >
                              Client chose this
                            </Button>
                          ) : null}

                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${quote.company} quote`}
                              loading={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await deleteQuoteAction(clientId, quote.id);
                                  if (!result.ok) setError(result.error);
                                })
                              }
                            >
                              <Trash2Icon className="size-3.5 text-critical" />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {error && !adding ? (
        <p className="rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { toNumber };
