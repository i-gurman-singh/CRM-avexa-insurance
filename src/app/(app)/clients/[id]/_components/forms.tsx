'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { FieldSource } from '@/lib/types';
import { toIsoDateInput } from '@/lib/dates';
import {
  addDriverAction,
  addVehicleAction,
  deleteDriverAction,
  deleteVehicleAction,
  updateClientAction,
  updateDriverAction,
  updateVehicleAction,
  verifyFieldsAction,
} from '@/server/actions/clients';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Select,
} from '@/ui/components/primitives';
import { ProvenanceBadge } from '@/ui/components/provenance';

/**
 * Edit forms for client, driver and vehicle records.
 *
 * Two things worth noting:
 *
 *  - Every field shows where its value came from. An amber "AI" chip means a
 *    model read it off a document and no one has checked it; saving the form
 *    promotes those fields to "entered by staff", because a person has now
 *    looked at them.
 *  - New fields are added by adding a row to the arrays below. Anything more
 *    business-specific belongs in Settings → Custom fields, which writes to
 *    the `customFields` JSON column and needs no code change at all.
 */

type Provenance = Record<string, { source: FieldSource; confidence: number | null } | undefined>;

interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'number' | 'select' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  span?: 1 | 2 | 3;
}

function ProvenanceFor({ provenance, name }: { provenance: Provenance; name: string }) {
  const entry = provenance[name];
  if (!entry) return null;
  return <ProvenanceBadge source={entry.source} confidence={entry.confidence} />;
}

function renderField(
  spec: FieldSpec,
  value: unknown,
  editing: boolean,
  provenance: Provenance,
  prefix = '',
) {
  const id = `${prefix}${spec.name}`;
  const badge = <ProvenanceFor provenance={provenance} name={spec.name} />;
  const display = formatDisplay(spec, value);

  if (!editing) {
    return (
      <Field key={spec.name} label={spec.label} badge={badge} className={spanClass(spec.span)}>
        <p className="truncate text-sm">{display}</p>
      </Field>
    );
  }

  if (spec.type === 'checkbox') {
    return (
      <Field key={spec.name} label={spec.label} badge={badge} className={spanClass(spec.span)}>
        <Checkbox name={spec.name} defaultChecked={Boolean(value)} value="true" />
      </Field>
    );
  }

  if (spec.type === 'select') {
    return (
      <Field key={spec.name} label={spec.label} htmlFor={id} badge={badge} className={spanClass(spec.span)}>
        <Select id={id} name={spec.name} defaultValue={(value as string) ?? ''}>
          <option value="">—</option>
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <Field key={spec.name} label={spec.label} htmlFor={id} badge={badge} className={spanClass(spec.span)}>
      <Input
        id={id}
        name={spec.name}
        type={spec.type ?? 'text'}
        placeholder={spec.placeholder}
        defaultValue={
          spec.type === 'date'
            ? toIsoDateInput(value as string)
            : ((value as string | number | null) ?? '')
        }
      />
    </Field>
  );
}

function spanClass(span?: 1 | 2 | 3) {
  return span === 3 ? 'sm:col-span-3' : span === 2 ? 'sm:col-span-2' : '';
}

function formatDisplay(spec: FieldSpec, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (spec.type === 'checkbox') return value ? 'Yes' : 'No';
  if (spec.type === 'date') return toIsoDateInput(value as string) || '—';
  if (spec.type === 'select') {
    return spec.options?.find((o) => o.value === value)?.label ?? String(value);
  }
  return String(value);
}

function collect(form: HTMLFormElement, specs: FieldSpec[]): Record<string, unknown> {
  const data = new FormData(form);
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    if (spec.type === 'checkbox') {
      out[spec.name] = data.get(spec.name) === 'true';
      continue;
    }
    const raw = data.get(spec.name);
    out[spec.name] = raw === null || raw === '' ? null : String(raw);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function EditableSection({
  title,
  specs,
  values,
  provenance,
  onSave,
  onDelete,
  entity,
  entityId,
  clientId,
  extra,
}: {
  title: ReactNode;
  specs: FieldSpec[];
  values: Record<string, unknown>;
  provenance: Provenance;
  onSave: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onDelete?: () => Promise<{ ok: boolean; error?: string }>;
  entity?: 'client' | 'driver' | 'vehicle';
  entityId?: string;
  clientId?: string;
  extra?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unverified = Object.entries(provenance)
    .filter(([, v]) => v?.source === 'AI_EXTRACTED')
    .map(([k]) => k);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-1">
          {!editing && unverified.length > 0 && entity && entityId && clientId ? (
            <Button
              variant="outline"
              size="sm"
              loading={pending}
              title={`Confirm ${unverified.length} AI-extracted value${unverified.length === 1 ? '' : 's'}`}
              onClick={() =>
                startTransition(async () => {
                  await verifyFieldsAction(clientId, entity, entityId, unverified);
                })
              }
            >
              Verify {unverified.length}
            </Button>
          ) : null}

          {onDelete && !editing ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await onDelete();
                  if (!result.ok) setError(result.error ?? 'Could not delete');
                })
              }
            >
              <Trash2Icon className="size-4 text-critical" />
            </Button>
          ) : null}

          {!editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon className="size-3.5" />
              Edit
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = collect(e.currentTarget, specs);
            setError(null);
            startTransition(async () => {
              const result = await onSave(input);
              if (result.ok) setEditing(false);
              else setError(result.error ?? 'Could not save');
            });
          }}
        >
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
            {specs.map((spec) => renderField(spec, values[spec.name], editing, provenance, `${entityId ?? ''}-`))}
          </dl>

          {extra}

          {error ? (
            <p className="mt-3 rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
              {error}
            </p>
          ) : null}

          {editing ? (
            <div className="mt-4 flex gap-2">
              <Button type="submit" size="sm" loading={pending}>
                <SaveIcon className="size-3.5" />
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <XIcon className="size-3.5" />
                Cancel
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

const CLIENT_FIELDS: FieldSpec[] = [
  { name: 'firstName', label: 'First name' },
  { name: 'lastName', label: 'Last name' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  {
    name: 'maritalStatus',
    label: 'Marital status',
    type: 'select',
    options: [
      { value: 'single', label: 'Single' },
      { value: 'married', label: 'Married' },
      { value: 'common_law', label: 'Common law' },
      { value: 'divorced', label: 'Divorced' },
      { value: 'widowed', label: 'Widowed' },
    ],
  },
  { name: 'addressLine1', label: 'Address', span: 2 },
  { name: 'addressLine2', label: 'Unit / suite' },
  { name: 'city', label: 'City' },
  { name: 'province', label: 'Province' },
  { name: 'postalCode', label: 'Postal code' },
  { name: 'altPhone', label: 'Alternate phone', type: 'tel' },
];

const DRIVER_FIELDS: FieldSpec[] = [
  { name: 'fullName', label: 'Name' },
  {
    name: 'relationship',
    label: 'Relationship',
    type: 'select',
    options: [
      { value: 'primary', label: 'Primary' },
      { value: 'spouse', label: 'Spouse' },
      { value: 'child', label: 'Child' },
      { value: 'other', label: 'Other' },
    ],
  },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { name: 'licenceNumber', label: 'Licence number' },
  {
    name: 'licenceClass',
    label: 'Licence class',
    type: 'select',
    options: [
      { value: 'G', label: 'G' },
      { value: 'G2', label: 'G2' },
      { value: 'G1', label: 'G1' },
      { value: 'M', label: 'M' },
      { value: 'other', label: 'Other' },
    ],
  },
  { name: 'licenceExpiry', label: 'Licence expiry', type: 'date' },
  { name: 'g1Date', label: 'G1 date', type: 'date' },
  { name: 'g2Date', label: 'G2 date', type: 'date' },
  { name: 'gDate', label: 'G date', type: 'date' },
  { name: 'yearsLicensed', label: 'Years licensed', type: 'number' },
  { name: 'driverTraining', label: 'Driver training', type: 'checkbox' },
  { name: 'internationalExperienceYears', label: 'International experience (yrs)', type: 'number' },
  { name: 'internationalExperienceCountry', label: 'Experience country' },
  { name: 'occupation', label: 'Occupation' },
];

const VEHICLE_FIELDS: FieldSpec[] = [
  { name: 'year', label: 'Year', type: 'number' },
  { name: 'make', label: 'Make' },
  { name: 'model', label: 'Model' },
  { name: 'vin', label: 'VIN', span: 2 },
  { name: 'plate', label: 'Plate' },
  {
    name: 'ownership',
    label: 'Ownership',
    type: 'select',
    options: [
      { value: 'owned', label: 'Owned' },
      { value: 'financed', label: 'Financed' },
      { value: 'leased', label: 'Leased' },
    ],
  },
  {
    name: 'usage',
    label: 'Usage',
    type: 'select',
    options: [
      { value: 'pleasure', label: 'Pleasure' },
      { value: 'commute', label: 'Commute' },
      { value: 'business', label: 'Business' },
    ],
  },
  { name: 'annualKilometres', label: 'Annual km', type: 'number' },
  { name: 'commuteOneWayKm', label: 'One-way commute (km)', type: 'number' },
  { name: 'winterTires', label: 'Winter tires', type: 'checkbox' },
  { name: 'antiTheftDevice', label: 'Anti-theft device', type: 'checkbox' },
  { name: 'lienholder', label: 'Lienholder' },
];

// ---------------------------------------------------------------------------
// Public components
// ---------------------------------------------------------------------------

export function ClientDetailsForm({
  clientId,
  values,
  provenance,
}: {
  clientId: string;
  values: Record<string, unknown>;
  provenance: Provenance;
}) {
  return (
    <EditableSection
      title="Personal information"
      specs={CLIENT_FIELDS}
      values={values}
      provenance={provenance}
      entity="client"
      entityId={clientId}
      clientId={clientId}
      onSave={(input) => updateClientAction(clientId, input)}
    />
  );
}

export function DriverCard({
  clientId,
  driver,
  provenance,
}: {
  clientId: string;
  driver: Record<string, unknown> & { id: string; fullName: string; isPrimary: boolean };
  provenance: Provenance;
}) {
  return (
    <EditableSection
      title={
        <span className="flex items-center gap-2">
          {driver.fullName}
          {driver.isPrimary ? (
            <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Primary
            </span>
          ) : null}
        </span>
      }
      specs={DRIVER_FIELDS}
      values={driver}
      provenance={provenance}
      entity="driver"
      entityId={driver.id}
      clientId={clientId}
      onSave={(input) => updateDriverAction(clientId, driver.id, input)}
      onDelete={() => deleteDriverAction(clientId, driver.id)}
    />
  );
}

export function VehicleCard({
  clientId,
  vehicle,
  provenance,
}: {
  clientId: string;
  vehicle: Record<string, unknown> & { id: string };
  provenance: Provenance;
}) {
  const title =
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';

  return (
    <EditableSection
      title={title}
      specs={VEHICLE_FIELDS}
      values={vehicle}
      provenance={provenance}
      entity="vehicle"
      entityId={vehicle.id}
      clientId={clientId}
      onSave={(input) => updateVehicleAction(clientId, vehicle.id, input)}
      onDelete={() => deleteVehicleAction(clientId, vehicle.id)}
    />
  );
}

export function AddDriverButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5" />
        Add driver
      </Button>
    );
  }

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await addDriverAction(clientId, { fullName: name });
          if (result.ok) {
            setName('');
            setOpen(false);
          } else setError(result.error);
        });
      }}
    >
      <Field label="Driver name" htmlFor="new-driver">
        <Input
          id="new-driver"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoFocus
          required
        />
      </Field>
      <Button type="submit" size="sm" loading={pending}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </form>
  );
}

export function AddVehicleButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5" />
        Add vehicle
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await addVehicleAction(clientId, {
            year: data.get('year') || null,
            make: data.get('make') || null,
            model: data.get('model') || null,
            vin: data.get('vin') || null,
          });
          if (result.ok) setOpen(false);
          else setError(result.error);
        });
      }}
    >
      <Field label="Year" htmlFor="v-year" className="w-24">
        <Input id="v-year" name="year" type="number" placeholder="2020" />
      </Field>
      <Field label="Make" htmlFor="v-make" className="w-32">
        <Input id="v-make" name="make" placeholder="Honda" />
      </Field>
      <Field label="Model" htmlFor="v-model" className="w-32">
        <Input id="v-model" name="model" placeholder="Civic" />
      </Field>
      <Field label="VIN" htmlFor="v-vin" className="w-52">
        <Input id="v-vin" name="vin" placeholder="Optional" />
      </Field>
      <Button type="submit" size="sm" loading={pending}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error ? <p className="w-full text-xs text-critical">{error}</p> : null}
    </form>
  );
}
