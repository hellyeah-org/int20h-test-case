import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { calculateAndStoreOne } from '#/lib/tax-engine.server'

export const createOrderSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  subtotal: z.number().min(0),
  timestamp: z.date().optional(),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

export const createOrder = createServerFn({ method: 'POST' })
  .inputValidator(createOrderSchema)
  .handler(async ({ data }) => {
    const result = await calculateAndStoreOne({
      latitude: data.latitude,
      longitude: data.longitude,
      subtotal: data.subtotal,
      timestamp: data.timestamp ?? new Date(),
    })
    return result
  })
