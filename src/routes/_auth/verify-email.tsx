import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { authClient } from '#/lib/auth-client'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Alert, AlertDescription } from '#/components/ui/alert'

export const Route = createFileRoute('/_auth/verify-email')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    setStatus('loading')

    authClient.verifyEmail({ query: { token } }).then(({ error }) => {
      if (error) {
        setErrorMessage(
          error.message ?? 'Verification failed. The link may have expired.',
        )
        setStatus('error')
      } else {
        setStatus('success')
      }
    })
  }, [token])

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Invalid link</CardTitle>
          <CardDescription>
            This verification link is missing a token. Please check your email
            for the correct link.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button asChild size="sm" variant="link" className="px-0 h-auto">
            <Link to="/sign-in">Go to sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Verifying…</CardTitle>
          <CardDescription>
            Please wait while we verify your email address.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Verification failed</CardTitle>
          <CardDescription>
            We couldn't verify your email address.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6">
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-center gap-2 text-sm">
          <Button asChild size="sm" variant="link" className="px-0 h-auto">
            <Link to="/sign-up">Try again</Link>
          </Button>
          <span className="text-muted-foreground">·</span>
          <Button asChild size="sm" variant="link" className="px-0 h-auto">
            <Link to="/sign-in">Sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Email verified</CardTitle>
        <CardDescription>
          Your email has been successfully verified. You can now sign in.
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-center">
        <Button asChild className="w-full">
          <Link to="/sign-in">Sign in to your account</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
