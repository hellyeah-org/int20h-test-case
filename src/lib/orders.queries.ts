import { queryOptions } from '@tanstack/react-query'

import { getOrders } from '#/lib/orders.functions'
import type { OrdersSearch } from '#/lib/orders.functions'

export function ordersQueryOptions(search: OrdersSearch) {
  return queryOptions({
    queryKey: ['orders', search] as const,
    queryFn: () => getOrders({ data: search }),
  })
}
