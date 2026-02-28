import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { getSession } from '#/lib/auth.functions'

export const Route = createFileRoute('/_auth')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/', search: { page: 1, pageSize: 20, sortBy: 'orderDate', sortDir: 'desc' } })
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </main>
  )
}
