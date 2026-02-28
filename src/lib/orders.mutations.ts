import { createServerFn } from '@tanstack/react-start'
import { format } from 'date-fns'
import { and, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { orders, taxLines, taxRates, jurisdictions } from '#/db/schema/tax'

export const createOrderSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  subtotal: z.number().min(0),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

export const createOrder = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => createOrderSchema.parse(input))
  .handler(async ({ data }) => {
    const { latitude, longitude, subtotal } = data
    const today = format(new Date(), 'yyyy-MM-dd')

    // Find all jurisdictions whose boundary contains the given point,
    // along with their active tax rate for today.
    const applicableRates = await db
      .select({
        jurisdictionId: jurisdictions.id,
        jurisdictionName: jurisdictions.name,
        jurisdictionKind: jurisdictions.kind,
        jurisdictionLevel: jurisdictions.level,
        taxRateId: taxRates.id,
        rate: taxRates.rate,
      })
      .from(jurisdictions)
      .innerJoin(
        taxRates,
        and(
          sql`${taxRates.jurisdictionId} = ${jurisdictions.id}`,
          sql`${taxRates.effectiveFrom} <= ${today}`,
          or(isNull(taxRates.effectiveTo), lte(taxRates.effectiveTo, today)),
        ),
      )
      .where(
        sql`ST_Contains(
          ${jurisdictions.boundary},
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        )`,
      )

    // Sum all applicable rates to get composite rate
    const compositeTaxRate = applicableRates.reduce(
      (sum, r) => sum + parseFloat(r.rate),
      0,
    )

    const subtotalNum = subtotal
    const taxAmount = Math.round(subtotalNum * compositeTaxRate * 100) / 100
    const totalAmount = Math.round((subtotalNum + taxAmount) * 100) / 100

    return await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          latitude: String(latitude),
          longitude: String(longitude),
          orderDate: today,
          subtotalAmount: String(subtotalNum),
          compositeTaxRate: String(compositeTaxRate),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
        })
        .returning()

      if (applicableRates.length > 0) {
        await tx.insert(taxLines).values(
          applicableRates.map((r) => ({
            orderId: order.id,
            taxRateId: r.taxRateId,
            jurisdictionId: r.jurisdictionId,
            rate: r.rate,
            amount: String(
              Math.round(subtotalNum * parseFloat(r.rate) * 100) / 100,
            ),
            jurisdictionName: r.jurisdictionName,
            jurisdictionKind: r.jurisdictionKind,
            jurisdictionLevel: r.jurisdictionLevel,
          })),
        )
      }

      return order
    })
  })
