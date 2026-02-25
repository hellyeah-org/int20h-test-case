import { createFormHook } from '@tanstack/react-form'

import { fieldContext, formContext } from './form-context'
import { TextField } from '#/components/form/field-components'
import { SubmitButton } from '#/components/form/form-components'

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
  },
  formComponents: {
    SubmitButton,
  },
})
