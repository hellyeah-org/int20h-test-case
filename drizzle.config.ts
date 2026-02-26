import { defineConfig } from 'drizzle-kit'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set')
}

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema/index.ts',
  dialect: 'postgresql',
  extensionsFilters: ['postgis'],
  tablesFilter: ['!spatial_ref_sys', '!geometry_columns', '!geography_columns'],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
