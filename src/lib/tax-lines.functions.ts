import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { taxLines } from '#/db/schema/tax'

export const getTaxLines = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    return db
      .select({
        id: taxLines.id,
        rate: taxLines.rate,
        amount: taxLines.amount,
        jurisdictionName: taxLines.jurisdictionName,
        jurisdictionKind: taxLines.jurisdictionKind,
        jurisdictionLevel: taxLines.jurisdictionLevel,
      })
      .from(taxLines)
      .where(eq(taxLines.orderId, data.orderId))
  })

export type TaxLine = Awaited<ReturnType<typeof getTaxLines>>[number]
