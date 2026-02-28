import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Github, Loader2 } from 'lucide-react'
import { z } from 'zod'
import { revalidateLogic } from '@tanstack/react-form'

import { authClient } from '#/lib/auth-client'
import { useAppForm } from '#/hooks/form'
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

export const Route = createFileRoute('/_auth/sign-in')({
  component: SignInPage,
})

function SignInPage() {
  const navigate = useNavigate()
  const [githubLoading, setGithubLoading] = useState(false)

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: z.object({
        email: z.string().email('Enter a valid email address'),
        password: z.string().min(1, 'Password is required'),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
        callbackURL: '/',
      })
      if (error) {
        formApi.setErrorMap({
          onSubmit: {
            form:
              error.status === 403
                ? 'Your email is not verified. Check your inbox for a verification link.'
                : (error.message ?? 'Invalid email or password.'),
            fields: {},
          },
        })
        return
      }
      navigate({ to: '/', search: { page: 1, pageSize: 20, sortBy: 'orderDate', sortDir: 'desc' } })
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>
          Enter your credentials or continue with GitHub
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Button
          className="w-full"
          disabled={githubLoading}
          type="button"
          variant="outline"
          onClick={handleGitHub}
        >
          {githubLoading ? <Loader2 className="animate-spin" /> : <Github />}
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

          <form.AppField name="email">
            {(field) => (
              <field.TextField label="Email" placeholder="you@example.com" />
            )}
          </form.AppField>

          <form.AppField name="password">
            {(field) => (
              <field.PasswordField
                autoComplete="current-password"
                label="Password"
                placeholder="••••••••"
              />
            )}
          </form.AppField>

          <div className="flex justify-end">
            <Button asChild className="h-auto px-0" size="sm" variant="link">
              <Link to="/reset-password">Forgot password?</Link>
            </Button>
          </div>

          <form.AppForm>
            <form.SubmitButton label="Sign in" />
          </form.AppForm>
        </form>
      </CardContent>

      <CardFooter className="justify-center text-sm">
        <span className="text-muted-foreground">
          Don&apos;t have an account?&nbsp;
        </span>
        <Button asChild className="h-auto px-0" size="sm" variant="link">
          <Link to="/sign-up">Sign up</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
