import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, gte, ilike, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { orders } from '#/db/schema/tax'

export const ordersSearchSchema = z.object({
  page: z.number().int().min(1).catch(1),
  pageSize: z.number().int().min(1).max(100).catch(20),
  sortBy: z
    .enum(['id', 'orderDate', 'subtotalAmount', 'totalAmount'])
    .catch('orderDate'),
  sortDir: z.enum(['asc', 'desc']).catch('desc'),
  id: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  subtotalMin: z.number().min(0).optional(),
  subtotalMax: z.number().min(0).optional(),
})

export type OrdersSearch = z.infer<typeof ordersSearchSchema>

const columnMap = {
  id: orders.id,
  orderDate: orders.orderDate,
  subtotalAmount: orders.subtotalAmount,
  totalAmount: orders.totalAmount,
} satisfies Record<string, unknown>

export const getOrders = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => ordersSearchSchema.parse(input))
  .handler(async ({ data }) => {
    const {
      page,
      pageSize,
      sortBy,
      sortDir,
      id,
      dateFrom,
      dateTo,
      subtotalMin,
      subtotalMax,
    } = data

    const conditions = []

    if (id) {
      conditions.push(ilike(orders.id, `%${id}%`))
    }
    if (dateFrom) {
      conditions.push(gte(orders.orderDate, dateFrom))
    }
    if (dateTo) {
      conditions.push(lte(orders.orderDate, dateTo))
    }
    if (subtotalMin !== undefined) {
      conditions.push(gte(orders.subtotalAmount, String(subtotalMin)))
    }
    if (subtotalMax !== undefined) {
      conditions.push(lte(orders.subtotalAmount, String(subtotalMax)))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const sortCol = columnMap[sortBy]
    const orderExpr = sortDir === 'asc' ? asc(sortCol) : desc(sortCol)

    const offset = (page - 1) * pageSize

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(where)
        .orderBy(orderExpr)
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(orders)
        .where(where),
    ])

    return { rows, total: count }
  })
