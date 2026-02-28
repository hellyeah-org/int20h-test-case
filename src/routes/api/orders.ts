import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse as parseCsv } from 'csv-parse/sync'
import { and, desc, gte, inArray, lte } from 'drizzle-orm'

import { db } from '#/db/index'
import { orders, taxLines } from '#/db/schema/tax'
import {
  type OrderInput,
  OrderInputSchema,
  calculateAndStoreOne,
  calculateOrderDetails,
} from '#/lib/tax-engine.server'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const OrdersJsonSchema = z.union([
  z.array(OrderInputSchema),
  z.object({ orders: z.array(OrderInputSchema) }),
])

const BoolQuery = z.preprocess((v) => {
  if (v === undefined || v === null) return undefined
  const s = String(v).toLowerCase().trim()
  if (s === '1' || s === 'true' || s === 'yes') return true
  if (s === '0' || s === 'false' || s === 'no') return false
  return v
}, z.boolean().optional())

const OrdersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      'createdAtDesc',
      'createdAtAsc',
      'orderDateDesc',
      'orderDateAsc',
      'totalDesc',
      'totalAsc',
    ])
    .default('createdAtDesc'),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sumFrom: z.coerce.number().min(0).optional(),
  sumTo: z.coerce.number().min(0).optional(),
  includeLines: BoolQuery,
  hasSpecial: BoolQuery,
  minRate: z.coerce.number().min(0).max(1).optional(),
  maxRate: z.coerce.number().min(0).max(1).optional(),
})

async function listOrders(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = OrdersListQuerySchema.parse(
    Object.fromEntries(url.searchParams.entries()),
  )
  const offset = (q.page - 1) * q.pageSize

  const whereParts: Array<any> = []
  if (q.dateFrom) whereParts.push(gte(orders.orderDate, q.dateFrom))
  if (q.dateTo) whereParts.push(lte(orders.orderDate, q.dateTo))
  if (q.sumFrom !== undefined)
    whereParts.push(gte(orders.totalAmount, String(q.sumFrom)))
  if (q.sumTo !== undefined)
    whereParts.push(lte(orders.totalAmount, String(q.sumTo)))

  const whereCond = whereParts.length ? and(...whereParts) : undefined

  const items = await db
    .select()
    .from(orders)
    .where(whereCond)
    .limit(q.pageSize)
    .offset(offset)
    .orderBy(desc(orders.createdAt))
  const orderIds = items.map((i) => i.id)
  const allLines = orderIds.length
    ? await db
        .select()
        .from(taxLines)
        .where(inArray(taxLines.orderId, orderIds))
    : []

  const responseItems = items.map((o) => {
    const lines = allLines.filter((l) => l.orderId === o.id)

    const specialRateSum = lines
      .filter(
        (l) => l.jurisdictionKind === 'SPECIAL' || l.jurisdictionLevel === null,
      )
      .reduce((sum, l) => sum + Number(l.rate), 0)

    return {
      id: o.id,
      latitude: Number(o.latitude),
      longitude: Number(o.longitude),
      order_date: o.orderDate,
      subtotal_amount: Number(o.subtotalAmount),
      composite_tax_rate: Number(o.compositeTaxRate),
      tax_amount: Number(o.taxAmount),
      total_amount: Number(o.totalAmount),
      breakdown: {
        state_rate: Number(
          lines.find((l) => l.jurisdictionLevel === 10)?.rate ?? 0,
        ),
        county_rate: Number(
          lines.find((l) => l.jurisdictionLevel === 20)?.rate ?? 0,
        ),
        city_rate: Number(
          lines.find((l) => l.jurisdictionLevel === 30)?.rate ?? 0,
        ),
        special_rates: specialRateSum,
      },
      jurisdictions: lines.map((l) => ({
        id: l.jurisdictionId,
        name: l.jurisdictionName,
        kind: l.jurisdictionKind,
        level: l.jurisdictionLevel,
        rate: Number(l.rate),
      })),
    }
  })

  return json({ page: q.page, pageSize: q.pageSize, items: responseItems })
}

export const Route = createFileRoute('/api/orders')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await listOrders(request)
        } catch (err) {
          return json({ error: 'failed_to_list' }, 500)
        }
      },
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const dryRun = url.searchParams.get('dryRun') === 'true'
          const ct = request.headers.get('content-type') ?? ''

          let inputs: Array<OrderInput> = []
          if (ct.includes('csv')) {
            const text = await request.text()
            const records = parseCsv(text, {
              columns: true,
              skip_empty_lines: true,
              trim: true,
            })
            inputs = z.array(OrderInputSchema).parse(records)
          } else {
            const body = await request.json()
            const parsed = OrdersJsonSchema.parse(body)
            inputs = Array.isArray(parsed) ? parsed : parsed.orders
          }

          const results = []
          for (const input of inputs) {
            results.push(
              dryRun
                ? await calculateOrderDetails(input)
                : await calculateAndStoreOne(input),
            )
          }
          return json({ orders: results })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'internal_error'
          return json({ error: msg }, 400)
        }
      },
    },
  },
  component: () => null,
})
