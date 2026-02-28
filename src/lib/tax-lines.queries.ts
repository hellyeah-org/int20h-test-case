import { queryOptions } from '@tanstack/react-query'

import { getTaxLines } from '#/lib/tax-lines.functions'

export function taxLinesQueryOptions(orderId: string) {
  return queryOptions({
    queryKey: ['tax-lines', orderId] as const,
    queryFn: () => getTaxLines({ data: { orderId } }),
  })
}
