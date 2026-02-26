import { sql } from 'drizzle-orm'
import {
  check,
  date,
  decimal,
  geometry,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const jurisdictionTypeEnum = pgEnum('jurisdiction_type', [
  'STATE',
  'COUNTY',
  'CITY',
  'SPECIAL',
])

export const jurisdictions = pgTable(
  'jurisdictions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    type: jurisdictionTypeEnum('type').notNull(),
    fipsCode: varchar('fips_code', { length: 20 }),
    nysReportingCode: varchar('nys_reporting_code', { length: 10 }),
    boundary: geometry('boundary', {
      type: 'multi_polygon',
      mode: 'xy',
      srid: 4326,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex('uq_jurisdictions_fips_code').on(t.fipsCode),
    uniqueIndex('uq_jurisdictions_nys_reporting_code').on(t.nysReportingCode),
    index('idx_jurisdictions_boundary_gist').using('gist', t.boundary),
    index('idx_jurisdictions_name_trgm_gin').using(
      'gin',
      t.name.op('gin_trgm_ops'),
    ),
    check('chk_jurisdictions_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check(
      'chk_jurisdictions_fips_numeric_or_null',
      sql`${t.fipsCode} IS NULL OR ${t.fipsCode} ~ '^[0-9]+$'`,
    ),
    check(
      'chk_jurisdictions_fips_length_by_type',
      sql`
        ${t.fipsCode} IS NULL OR
        (${t.type} = 'STATE'  AND char_length(${t.fipsCode}) = 2) OR
        (${t.type} = 'COUNTY' AND char_length(${t.fipsCode}) = 5) OR
        (${t.type} = 'CITY'   AND char_length(${t.fipsCode}) = 7) OR
        (${t.type} = 'SPECIAL')
      `,
    ),
  ],
)

export const taxRates = pgTable(
  'tax_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jurisdictionId: uuid('jurisdiction_id')
      .references(() => jurisdictions.id, { onDelete: 'cascade' })
      .notNull(),
    rate: decimal('rate', { precision: 10, scale: 6 }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('idx_tax_rates_jurisdiction_from').on(
      t.jurisdictionId,
      t.effectiveFrom,
    ),
    check(
      'chk_tax_rates_rate_fraction_0_1',
      sql`${t.rate} >= 0 AND ${t.rate} <= 1`,
    ),
    check(
      'chk_tax_rates_effective_to_gt_from',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
)
