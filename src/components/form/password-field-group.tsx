import { withFieldGroup } from '#/hooks/form'
import { FieldGroup } from '#/components/ui/field'

export const PasswordFieldGroup = withFieldGroup({
  defaultValues: {
    password: '',
    confirm_password: '',
  },
  props: {
    passwordLabel: 'Password',
    confirmLabel: 'Confirm password',
  },
  render: function Render({ group, passwordLabel, confirmLabel }) {
    return (
      <FieldGroup>
        <group.AppField name="password">
          {(field) => (
            <field.PasswordField
              autoComplete="new-password"
              label={passwordLabel}
              placeholder="••••••••"
            />
          )}
        </group.AppField>
        <group.AppField name="confirm_password">
          {(field) => (
            <field.PasswordField
              autoComplete="new-password"
              label={confirmLabel}
              placeholder="••••••••"
            />
          )}
        </group.AppField>
      </FieldGroup>
    )
  },
})
