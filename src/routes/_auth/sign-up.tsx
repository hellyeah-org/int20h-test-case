import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Github, Loader2 } from 'lucide-react'
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
import { Separator } from '#/components/ui/separator'

export const Route = createFileRoute('/_auth/sign-up')({
  component: SignUpPage,
})

const signUpSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  })

function SignUpPage() {
  const [success, setSuccess] = useState(false)
  const [githubLoading, setGithubLoading] = useState(false)

  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '', confirm_password: '' },
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: { onDynamic: signUpSchema },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.signUp.email({
        name: value.name,
        email: value.email,
        password: value.password,
        callbackURL: '/',
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
      setSuccess(true)
    },
  })

  const handleGitHub = async () => {
    setGithubLoading(true)
    try {
      await authClient.signIn.social({ provider: 'github', callbackURL: '/' })
    } catch {
      setGithubLoading(false)
    }
  }

  if (success) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <CardDescription>
            We've sent a verification link to your inbox. Click it to activate
            your account.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center text-sm">
          <span className="text-muted-foreground">Already verified?&nbsp;</span>
          <Button asChild size="sm" variant="link" className="h-auto px-0">
            <Link to="/sign-in">Sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>
          Sign up with your email or continue with GitHub
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Button
          className="w-full"
          type="button"
          variant="outline"
          onClick={handleGitHub}
          disabled={githubLoading}
        >
          {githubLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Github />
          )}
          Continue with GitHub
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-muted-foreground text-xs">or</span>
          <Separator className="flex-1" />
        </div>

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

          <form.AppField name="name">
            {(field) => <field.TextField label="Name" placeholder="Jane Doe" />}
          </form.AppField>

          <form.AppField name="email">
            {(field) => (
              <field.TextField label="Email" placeholder="you@example.com" />
            )}
          </form.AppField>

          <PasswordFieldGroup
            form={form}
            fields={{
              password: 'password',
              confirm_password: 'confirm_password',
            }}
            passwordLabel="Password"
            confirmLabel="Confirm password"
          />

          <form.AppForm>
            <form.SubmitButton label="Create account" />
          </form.AppForm>
        </form>
      </CardContent>

      <CardFooter className="justify-center text-sm">
        <span className="text-muted-foreground">
          Already have an account?&nbsp;
        </span>
        <Button asChild size="sm" variant="link" className="h-auto px-0">
          <Link to="/sign-in">Sign in</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
