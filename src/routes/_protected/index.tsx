import { createFileRoute } from '@tanstack/react-router'

import { OrdersDataTable } from '#/components/orders/orders-data-table'
import { ordersQueryOptions } from '#/lib/orders.queries'
import { ordersSearchSchema } from '#/lib/orders.functions'

export const Route = createFileRoute('/_protected/')({
  validateSearch: (search) => ordersSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps }) =>
    queryClient.ensureQueryData(ordersQueryOptions(deps)),
  component: HomePage,
})

function HomePage() {
  return (
    <main className="container mx-auto py-8 px-4">
      <OrdersDataTable />
    </main>
  )
}
