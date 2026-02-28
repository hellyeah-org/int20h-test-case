import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import ws from 'ws'

import { relations } from './relations'
import { serverEnv } from '#/env/server'

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: serverEnv.DATABASE_URL })

export const db = drizzle({ client: pool, relations })
