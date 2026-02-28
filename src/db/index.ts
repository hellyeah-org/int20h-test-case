import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import { relations } from './relations'
import { serverEnv } from '#/env/server'

const sql = neon(serverEnv.DATABASE_URL)

export const db = drizzle({ client: sql, relations })
