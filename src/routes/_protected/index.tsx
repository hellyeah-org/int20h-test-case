import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-muted-foreground max-w-sm text-center">
        You&apos;re signed in. This is your home page.
      </p>
    </main>
  )
}
