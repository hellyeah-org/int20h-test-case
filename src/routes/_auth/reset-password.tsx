import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { revalidateLogic } from '@tanstack/react-form'

import { authClient } from '#/lib/auth-client'
import { useAppForm } from '#/hooks/form'
import { PasswordFieldGroup } from '@/components/form/password-field-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/_auth/reset-password')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage,
})

const requestResetSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

const confirmResetSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  })

function RequestResetForm() {
  const [sent, setSent] = useState(false)

  const form = useAppForm({
    defaultValues: { email: '' },
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: { onDynamic: requestResetSchema },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.requestPasswordReset({
        email: value.email,
        redirectTo: '/reset-password',
      })
      if (error) {
        formApi.setErrorMap({
          onSubmit: {
            form: error.message ?? 'Something went wrong. Please try again.',
            fields: {},
          },
        })
        return
      }
      setSent(true)
    },
  })

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <CardDescription>
            If an account with that email exists, we&apos;ve sent a password
            reset link. It expires in 1 hour.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center text-sm">
          <Button asChild className="h-auto px-0" size="sm" variant="link">
            <Link to="/sign-in">Back to sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Forgot password?</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            form.handleSubmit()
          }}
        >
          <form.AppForm>
            <form.FormError />
          </form.AppForm>

          <form.AppField name="email">
            {(field) => (
              <field.TextField label="Email" placeholder="you@example.com" />
            )}
          </form.AppField>

          <form.AppForm>
            <form.SubmitButton label="Send reset link" />
          </form.AppForm>
        </form>
      </CardContent>

      <CardFooter className="justify-center text-sm">
        <Button asChild className="h-auto px-0" size="sm" variant="link">
          <Link to="/sign-in">Back to sign in</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function ConfirmResetForm({ token }: { token: string }) {
  const navigate = useNavigate()

  const form = useAppForm({
    defaultValues: { password: '', confirm_password: '' },
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: { onDynamic: confirmResetSchema },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.resetPassword({
        newPassword: value.password,
        token,
      })
      if (error) {
        formApi.setErrorMap({
          onSubmit: {
            form: error.message ?? 'Something went wrong. Please try again.',
            fields: {},
          },
        })
        return
      }
      navigate({ to: '/sign-in' })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Set new password</CardTitle>
        <CardDescription>
          Choose a strong password for your account.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            form.handleSubmit()
          }}
        >
          <form.AppForm>
            <form.FormError />
          </form.AppForm>

          <PasswordFieldGroup
            confirmLabel="Confirm new password"
            fields={{
              password: 'password',
              confirm_password: 'confirm_password',
            }}
            form={form}
            passwordLabel="New password"
          />

          <form.AppForm>
            <form.SubmitButton label="Set new password" />
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  )
}

function ResetPasswordPage() {
  const { token } = Route.useSearch()

  if (token) {
    return <ConfirmResetForm token={token} />
  }

  return <RequestResetForm />
}
