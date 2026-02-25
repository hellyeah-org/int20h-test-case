import { useFormContext } from '#/hooks/form-context'
import { Button } from '#/components/ui/button'

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
