import { createFormHook } from '@tanstack/react-form'

import { fieldContext, formContext } from './form-context'
import { PasswordField, TextField } from '#/components/form/field-components'
import { FormError, SubmitButton } from '#/components/form/form-components'

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    PasswordField,
  },
  formComponents: {
    SubmitButton,
    FormError,
  },
})
