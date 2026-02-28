'use client'

import { Suspense, lazy, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { revalidateLogic, useStore } from '@tanstack/react-form'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { useAppForm } from '#/hooks/form'
import { createOrder } from '#/lib/orders.mutations'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#/components/ui/input-group'

// Lazy-load the map (Leaflet requires window — not SSR safe)
const NyMapPicker = lazy(() =>
  import('./ny-map-picker').then((m) => ({ default: m.NyMapPicker })),
)

// ─── Validation schema ────────────────────────────────────────────────────────
// Keeps values as strings (matching form defaultValues) and validates the string
// is parseable as a number in range. Coercion to number happens in onSubmit.

const createOrderSchema = z.object({
  latitude: z
    .string()
    .min(1, 'Latitude is required')
    .refine((v) => !isNaN(Number(v)), { message: 'Must be a number' })
    .refine((v) => Number(v) >= -90, { message: 'Latitude must be ≥ -90' })
    .refine((v) => Number(v) <= 90, { message: 'Latitude must be ≤ 90' }),
  longitude: z
    .string()
    .min(1, 'Longitude is required')
    .refine((v) => !isNaN(Number(v)), { message: 'Must be a number' })
    .refine((v) => Number(v) >= -180, { message: 'Longitude must be ≥ -180' })
    .refine((v) => Number(v) <= 180, { message: 'Longitude must be ≤ 180' }),
  subtotal: z
    .string()
    .min(1, 'Subtotal is required')
    .refine((v) => !isNaN(Number(v)), { message: 'Must be a number' })
    .refine((v) => Number(v) >= 0, { message: 'Subtotal must be ≥ 0' }),
})

// ─── CreateOrderDialog ────────────────────────────────────────────────────────

export function CreateOrderDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const form = useAppForm({
    defaultValues: {
      latitude: '',
      longitude: '',
      subtotal: '',
    },
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: { onDynamic: createOrderSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await createOrder({
          data: {
            latitude: Number(value.latitude),
            longitude: Number(value.longitude),
            subtotal: Number(value.subtotal),
          },
        })
        await queryClient.invalidateQueries({ queryKey: ['orders'] })
        toast.success('Order created successfully')
        setOpen(false)
        formApi.reset()
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to create order. Please try again.'
        formApi.setErrorMap({
          onSubmit: {
            form: message,
            fields: {},
          },
        })
      }
    },
  })

  // Derive map marker position from form string values
  const latRaw = useStore(form.store, (s) => s.values.latitude)
  const lonRaw = useStore(form.store, (s) => s.values.longitude)
  const submissionAttempts = useStore(form.store, (s) => s.submissionAttempts)

  const mapValue = {
    lat: latRaw !== '' && !isNaN(Number(latRaw)) ? Number(latRaw) : null,
    lon: lonRaw !== '' && !isNaN(Number(lonRaw)) ? Number(lonRaw) : null,
  }

  // Map click = the user has actively chosen a point, equivalent to typing a
  // value and blurring. Clear stale errors synchronously first so there is
  // never a render with an outdated error while validateField is in-flight,
  // then re-validate in blur mode so revalidateLogic fires onDynamic.
  const handleMapChange = useCallback(
    (lat: number, lon: number) => {
      form.setFieldMeta('latitude', (prev) => ({
        ...prev,
        errorMap: { ...prev.errorMap, onBlur: undefined, onDynamic: undefined },
      }))
      form.setFieldMeta('longitude', (prev) => ({
        ...prev,
        errorMap: { ...prev.errorMap, onBlur: undefined, onDynamic: undefined },
      }))
      form.setFieldValue('latitude', String(lat))
      form.setFieldValue('longitude', String(lon))
      void form.validateField('latitude', 'blur')
      void form.validateField('longitude', 'blur')
    },
    [form],
  )

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="default">
          <PlusIcon className="mr-1.5 size-4" />
          Add Order
        </Button>
      </DialogTrigger>

        <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Create Order</DialogTitle>
          <DialogDescription>
            Click the map to set the delivery location, or enter coordinates
            manually.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            form.handleSubmit()
          }}
        >
          {/* NY State Map */}
          <Suspense
            fallback={
              <div
                className="bg-muted animate-pulse rounded-lg"
                style={{ height: 240 }}
              />
            }
          >
            <NyMapPicker
              className="rounded-lg border"
              value={mapValue}
              onChange={handleMapChange}
            />
          </Suspense>

          {/* Lat / Lon side by side */}
          <div className="grid grid-cols-2 items-start gap-3">
            <form.AppField name="latitude">
              {(field) => {
                const isInvalid =
                  (field.state.meta.isBlurred || submissionAttempts > 0) &&
                  !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>Latitude</FieldLabel>
                    </FieldContent>
                    <Input
                      aria-invalid={isInvalid}
                      id={field.name}
                      inputMode="decimal"
                      name={field.name}
                      placeholder="40.7128"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.AppField>

            <form.AppField name="longitude">
              {(field) => {
                const isInvalid =
                  (field.state.meta.isBlurred || submissionAttempts > 0) &&
                  !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>Longitude</FieldLabel>
                    </FieldContent>
                    <Input
                      aria-invalid={isInvalid}
                      id={field.name}
                      inputMode="decimal"
                      name={field.name}
                      placeholder="-74.0060"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.AppField>
          </div>

          {/* Subtotal with $ prefix */}
          <form.AppField name="subtotal">
            {(field) => {
              const isInvalid =
                (field.state.meta.isBlurred || submissionAttempts > 0) &&
                !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldContent>
                    <FieldLabel htmlFor={field.name}>Subtotal</FieldLabel>
                  </FieldContent>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">$</InputGroupAddon>
                    <InputGroupInput
                      aria-invalid={isInvalid}
                      id={field.name}
                      inputMode="decimal"
                      name={field.name}
                      placeholder="0.00"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </InputGroup>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.AppField>

          {/* Form-level server error */}
          <form.AppForm>
            <form.FormError />
          </form.AppForm>

          <DialogFooter showCloseButton>
            <form.AppForm>
              <form.SubmitButton label="Create Order" />
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
