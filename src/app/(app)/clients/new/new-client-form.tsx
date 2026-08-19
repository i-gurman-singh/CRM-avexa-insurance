'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClientAction } from '@/server/actions/clients';
import { Button, Card, CardContent, Field, Input, Select } from '@/ui/components/primitives';

export function NewClientForm({
  stages,
  sources,
  users,
}: {
  stages: Array<{ id: string; name: string; isDefault: boolean }>;
  sources: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const defaultStage = stages.find((s) => s.isDefault) ?? stages[0];

  return (
    <Card>
      <CardContent className="p-5 pt-5">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setError(null);
            setFieldErrors({});

            startTransition(async () => {
              const result = await createClientAction({
                firstName: data.get('firstName') || null,
                lastName: data.get('lastName') || null,
                phone: data.get('phone'),
                email: data.get('email') || null,
                dateOfBirth: data.get('dateOfBirth') || null,
                addressLine1: data.get('addressLine1') || null,
                city: data.get('city') || null,
                province: data.get('province') || null,
                postalCode: data.get('postalCode') || null,
                stageId: data.get('stageId') || undefined,
                leadSourceId: data.get('leadSourceId') || null,
                assignedUserId: data.get('assignedUserId') || null,
                products: [String(data.get('product') ?? 'auto')],
              });

              if (result.ok) router.push(`/clients/${result.data.id}`);
              else {
                setError(result.error);
                setFieldErrors(result.fieldErrors ?? {});
              }
            });
          }}
        >
          <Field label="First name" htmlFor="firstName">
            <Input id="firstName" name="firstName" autoFocus />
          </Field>

          <Field label="Last name" htmlFor="lastName">
            <Input id="lastName" name="lastName" />
          </Field>

          <Field
            label="Phone"
            htmlFor="phone"
            required
            error={fieldErrors.phone?.[0]}
            hint="This is how WhatsApp conversations are matched to the client"
          >
            <Input id="phone" name="phone" type="tel" required placeholder="(416) 555-0123" />
          </Field>

          <Field label="Email" htmlFor="email" error={fieldErrors.email?.[0]}>
            <Input id="email" name="email" type="email" />
          </Field>

          <Field label="Date of birth" htmlFor="dateOfBirth">
            <Input id="dateOfBirth" name="dateOfBirth" type="date" />
          </Field>

          <Field label="Product" htmlFor="product">
            <Select id="product" name="product" defaultValue="auto">
              <option value="auto">Auto</option>
              <option value="home">Home</option>
              <option value="tenant">Tenant</option>
              <option value="commercial">Commercial</option>
              <option value="travel">Travel</option>
            </Select>
          </Field>

          <Field label="Address" htmlFor="addressLine1" className="sm:col-span-2">
            <Input id="addressLine1" name="addressLine1" />
          </Field>

          <Field label="City" htmlFor="city">
            <Input id="city" name="city" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Province" htmlFor="province">
              <Input id="province" name="province" defaultValue="ON" />
            </Field>
            <Field label="Postal code" htmlFor="postalCode">
              <Input id="postalCode" name="postalCode" />
            </Field>
          </div>

          <Field label="Stage" htmlFor="stageId">
            <Select id="stageId" name="stageId" defaultValue={defaultStage?.id}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Lead source" htmlFor="leadSourceId">
            <Select id="leadSourceId" name="leadSourceId">
              <option value="">Not recorded</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assign to" htmlFor="assignedUserId" className="sm:col-span-2">
            <Select id="assignedUserId" name="assignedUserId">
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>

          {error ? (
            <p className="sm:col-span-2 rounded-md bg-critical-subtle px-3 py-2 text-xs text-critical" role="alert">
              {error}
            </p>
          ) : null}

          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" loading={pending}>
              Create client
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
