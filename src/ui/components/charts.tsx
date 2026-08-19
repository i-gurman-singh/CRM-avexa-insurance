'use client';

import { useId, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TableIcon } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from './primitives';

/**
 * Chart components.
 *
 * Conventions applied consistently, so every chart in the CRM reads as one
 * system:
 *
 *  - Colour comes from the four validated categorical tokens, assigned in
 *    fixed order. Never a generated fifth hue.
 *  - Text never wears the series colour; identity comes from a swatch beside
 *    the label.
 *  - Bars are capped at 24px with a rounded data-end, gridlines are hairline
 *    and horizontal only, axes are recessive.
 *  - Every chart has a hover tooltip and a "Show table" toggle, so the numbers
 *    are always reachable without reading colour — which is also what makes
 *    the one low-contrast hue safe to use.
 */

const SERIES_VARS = ['--color-chart-1', '--color-chart-2', '--color-chart-3', '--color-chart-4'];

export function seriesColor(index: number): string {
  return `var(${SERIES_VARS[index % SERIES_VARS.length]})`;
}

const AXIS_STYLE = { fontSize: 11, fill: 'var(--color-muted-foreground)' } as const;

/**
 * Value formatting is chosen with a string rather than a function, because a
 * function cannot cross the server/client boundary — these charts are rendered
 * from server components, so the prop has to be serialisable.
 */
export type ValueFormat = 'number' | 'currency' | 'percent' | 'days';

const FORMATTERS: Record<ValueFormat, (n: number) => string> = {
  number: formatNumber,
  currency: (n) => formatCurrency(n, 'CAD', { compact: true }),
  percent: (n) => `${n.toFixed(1)}%`,
  days: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
};

interface Datum {
  label: string;
  value: number;
  /** Optional secondary value shown in the table and tooltip. */
  secondary?: number;
  secondaryLabel?: string;
}

function ChartFrame({
  title,
  description,
  data,
  valueLabel,
  secondaryLabel,
  children,
  format = 'number',
}: {
  title: string;
  description?: string;
  data: Datum[];
  valueLabel: string;
  secondaryLabel?: string;
  children: React.ReactNode;
  format?: ValueFormat;
}) {
  const formatValue = FORMATTERS[format];
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((v) => !v)}
        >
          <TableIcon className="size-3.5" />
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </CardHeader>

      <CardContent>
        {data.length === 0 ? (
          <EmptyState title="No data yet" description="This chart fills in as business flows through the CRM." />
        ) : showTable ? (
          <div id={tableId} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 text-left text-xs font-medium text-muted-foreground uppercase">
                    Item
                  </th>
                  <th className="py-2 text-right text-xs font-medium text-muted-foreground uppercase">
                    {valueLabel}
                  </th>
                  {secondaryLabel ? (
                    <th className="py-2 text-right text-xs font-medium text-muted-foreground uppercase">
                      {secondaryLabel}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((d) => (
                  <tr key={d.label}>
                    <td className="py-1.5">{d.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue(d.value)}</td>
                    {secondaryLabel ? (
                      <td className="py-1.5 text-right tabular-nums">
                        {d.secondary === undefined ? '—' : formatValue(d.secondary)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: Datum }>;
  label?: string;
  valueLabel: string;
  formatValue: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]!;

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-overlay)]">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">
        {valueLabel}: <span className="font-medium text-foreground">{formatValue(datum.value)}</span>
      </p>
      {datum.payload.secondary !== undefined && datum.payload.secondaryLabel ? (
        <p className="text-muted-foreground">
          {datum.payload.secondaryLabel}:{' '}
          <span className="font-medium text-foreground">{formatValue(datum.payload.secondary)}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Horizontal bars — the default for comparing named categories, because the
 * labels are readable without rotating them.
 */
export function CategoryBarChart({
  title,
  description,
  data,
  valueLabel,
  secondaryLabel,
  format = 'number',
  colorIndex = 0,
  highlightMax = false,
}: {
  title: string;
  description?: string;
  data: Datum[];
  valueLabel: string;
  secondaryLabel?: string;
  format?: ValueFormat;
  colorIndex?: number;
  /** Emphasise the largest bar — used where "which is biggest" is the point. */
  highlightMax?: boolean;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const formatValue = FORMATTERS[format];

  return (
    <ChartFrame
      title={title}
      description={description}
      data={data}
      valueLabel={valueLabel}
      secondaryLabel={secondaryLabel}
      format={format}
    >
      <div style={{ height: Math.max(160, data.length * 34 + 24) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeWidth={1} />
            <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS_STYLE}
              axisLine={false}
              tickLine={false}
              width={124}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-muted)' }}
              content={<ChartTooltip valueLabel={valueLabel} formatValue={formatValue} />}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.label}
                  fill={seriesColor(colorIndex)}
                  fillOpacity={highlightMax && d.value < max ? 0.45 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/** Time series — one series, so no legend box; the title names what is plotted. */
export function TrendChart({
  title,
  description,
  data,
  valueLabel,
  format = 'number',
  colorIndex = 0,
}: {
  title: string;
  description?: string;
  data: Datum[];
  valueLabel: string;
  format?: ValueFormat;
  colorIndex?: number;
}) {
  const formatValue = FORMATTERS[format];

  return (
    <ChartFrame
      title={title}
      description={description}
      data={data}
      valueLabel={valueLabel}
      format={format}
    >
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeWidth={1} />
            <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ stroke: 'var(--color-border-strong)', strokeWidth: 1 }}
              content={<ChartTooltip valueLabel={valueLabel} formatValue={formatValue} />}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={seriesColor(colorIndex)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/**
 * Conversion funnel. Not a chart library funnel — just proportional bars with
 * the numbers written on, which is easier to read and impossible to mis-scale.
 */
export function FunnelChart({
  title,
  description,
  stages,
}: {
  title: string;
  description?: string;
  stages: Array<{ label: string; value: number; color?: string }>;
}) {
  const max = Math.max(...stages.map((s) => s.value), 1);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent>
        {stages.length === 0 ? (
          <EmptyState title="No pipeline data" />
        ) : (
          <ol className="space-y-2">
            {stages.map((stage, index) => {
              const width = Math.max(2, (stage.value / max) * 100);
              const previous = stages[index - 1];
              const dropOff =
                previous && previous.value > 0
                  ? Math.round((1 - stage.value / previous.value) * 100)
                  : null;

              return (
                <li key={stage.label} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">
                    {stage.label}
                  </span>
                  <span className="relative h-6 flex-1 overflow-hidden rounded-sm bg-surface-muted">
                    <span
                      className="absolute inset-y-0 left-0 rounded-r-[4px]"
                      style={{
                        width: `${width}%`,
                        backgroundColor: stage.color ?? seriesColor(0),
                      }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
                    {stage.value}
                  </span>
                  <span
                    className={cn(
                      'w-14 shrink-0 text-right text-[11px] tabular-nums',
                      dropOff !== null && dropOff > 50 ? 'text-critical' : 'text-muted-foreground',
                    )}
                  >
                    {dropOff === null ? '' : `−${dropOff}%`}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Legend swatch — identity beside text, never coloured text. */
export function LegendSwatch({ index, label }: { index: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className="size-2.5 rounded-sm"
        style={{ backgroundColor: seriesColor(index) }}
        aria-hidden
      />
      {label}
    </span>
  );
}
