import { useFieldContext } from '#/hooks/form-context'
import { Input } from '#/components/ui/input'

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#/components/ui/field'

export function TextField({
  label,
  description,
  placeholder,
  className,
}: {
  label: string
  description?: string
  placeholder?: string
  className?: string
}) {
  const field = useFieldContext<string>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid}>
      <FieldContent>
        <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Input
        aria-invalid={isInvalid}
        autoComplete="off"
        className={className}
        id={field.name}
        name={field.name}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
