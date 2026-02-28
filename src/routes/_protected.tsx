import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { getSession } from '#/lib/auth.functions'
import { AppHeader } from '#/components/app-header'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/sign-in' })
    }
    return { session }
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const { session } = Route.useRouteContext()

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={session.user} />
      <Outlet />
    </div>
  )
}
