import { CircleAlertIcon } from 'lucide-react'
import { useFormContext } from '#/hooks/form-context'
import { Button } from '#/components/ui/button'
import { Alert, AlertDescription } from '#/components/ui/alert'

export function SubmitButton({
  label = 'Submit',
  variant = 'default',
}: {
  label?: string
  variant?: React.ComponentProps<typeof Button>['variant']
}) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button disabled={isSubmitting} type="submit" variant={variant}>
          {isSubmitting ? 'Submitting…' : label}
        </Button>
      )}
    </form.Subscribe>
  )
}

export function FormError() {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(formError) => {
        const message =
          formError && typeof formError === 'object' && 'form' in formError
            ? String(formError.form)
            : typeof formError === 'string'
              ? formError
              : null
        return message ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null
      }}
    </form.Subscribe>
  )
}
