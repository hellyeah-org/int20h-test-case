import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
