import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useStore } from '@tanstack/react-form'

import { useFieldContext } from '#/hooks/form-context'
import { Input } from '#/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '#/components/ui/input-group'

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
  const submissionAttempts = useStore(
    field.form.store,
    (s) => s.submissionAttempts,
  )
  const isInvalid =
    (field.state.meta.isBlurred || submissionAttempts > 0) &&
    !field.state.meta.isValid

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

export function PasswordField({
  label,
  description,
  placeholder,
  autoComplete = 'current-password',
}: {
  label: string
  description?: string
  placeholder?: string
  autoComplete?: string
}) {
  const field = useFieldContext<string>()
  const submissionAttempts = useStore(
    field.form.store,
    (s) => s.submissionAttempts,
  )
  const isInvalid =
    (field.state.meta.isBlurred || submissionAttempts > 0) &&
    !field.state.meta.isValid
  const [visible, setVisible] = useState(false)

  return (
    <Field data-invalid={isInvalid}>
      <FieldContent>
        <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <InputGroup>
        <InputGroupInput
          aria-invalid={isInvalid}
          autoComplete={autoComplete}
          id={field.name}
          name={field.name}
          placeholder={placeholder}
          type={visible ? 'text' : 'password'}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={visible ? 'Hide password' : 'Show password'}
            size="icon-sm"
            tabIndex={-1}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
