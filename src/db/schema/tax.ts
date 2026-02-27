import { sql } from 'drizzle-orm'
import {
  check,
  date,
  decimal,
  geometry,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const jurisdictionKindEnum = pgEnum('jurisdiction_kind', [
  'ADMINISTRATIVE',
  'SPECIAL',
])

export const jurisdictions = pgTable(
  'jurisdictions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    kind: jurisdictionKindEnum('kind').notNull(),
    level: smallint('level'),
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
    check('chk_jurisdictions_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check(
      'chk_jurisdictions_level_presence',
      sql`
        (${t.kind} = 'ADMINISTRATIVE' AND ${t.level} IS NOT NULL) OR
        (${t.kind} <> 'ADMINISTRATIVE' AND ${t.level} IS NULL)
      `,
    ),
    check(
      'chk_jurisdictions_level_range',
      sql`${t.level} IS NULL OR (${t.level} >= 0 AND ${t.level} <= 10)`,
    ),
    index('idx_jurisdictions_boundary_gist').using('gist', t.boundary),
    index('idx_jurisdictions_name_trgm_gin').using(
      'gin',
      t.name.op('gin_trgm_ops'),
    ),
  ],
)
export const identifierSystems = pgTable(
  'identifier_systems',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 120 }).notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check('chk_identifier_systems_key_not_blank', sql`btrim(${t.key}) <> ''`),
    check('chk_identifier_systems_name_not_blank', sql`btrim(${t.name}) <> ''`),
    uniqueIndex('uq_identifier_systems_key').on(t.key),
  ],
)

export const jurisdictionIdentifiers = pgTable(
  'jurisdiction_identifiers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jurisdictionId: uuid('jurisdiction_id')
      .references(() => jurisdictions.id, { onDelete: 'cascade' })
      .notNull(),
    systemId: uuid('system_id')
      .references(() => identifierSystems.id, { onDelete: 'restrict' })
      .notNull(),
    scope: varchar('scope', { length: 64 }),
    valueRaw: varchar('value_raw', { length: 120 }).notNull(),
    valueNorm: varchar('value_norm', { length: 120 }).notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check(
      'chk_jurisdiction_identifiers_value_raw_not_blank',
      sql`btrim(${t.valueRaw}) <> ''`,
    ),
    check(
      'chk_jurisdiction_identifiers_value_norm_not_blank',
      sql`btrim(${t.valueNorm}) <> ''`,
    ),
    check(
      'chk_jurisdiction_identifiers_scope_not_blank',
      sql`${t.scope} IS NULL OR btrim(${t.scope}) <> ''`,
    ),
    check(
      'chk_jurisdiction_identifiers_valid_to_gt_from',
      sql`${t.validTo} IS NULL OR ${t.validFrom} IS NULL OR ${t.validTo} > ${t.validFrom}`,
    ),
    uniqueIndex('uq_jurisdiction_identifiers_exact').on(
      t.systemId,
      t.scope,
      t.valueNorm,
      t.jurisdictionId,
      t.validFrom,
      t.validTo,
    ),
    index('idx_jurisdiction_identifiers_lookup').on(
      t.systemId,
      t.scope,
      t.valueNorm,
    ),
    index('idx_jurisdiction_identifiers_lookup_asof').on(
      t.systemId,
      t.scope,
      t.valueNorm,
      t.validFrom,
      t.validTo,
    ),
    index('idx_jurisdiction_identifiers_reverse').on(
      t.jurisdictionId,
      t.systemId,
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
    check(
      'chk_tax_rates_rate_fraction_0_1',
      sql`${t.rate} >= 0 AND ${t.rate} <= 1`,
    ),
    check(
      'chk_tax_rates_effective_to_gt_from',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    index('idx_tax_rates_jurisdiction_from').on(
      t.jurisdictionId,
      t.effectiveFrom,
    ),
    index('idx_tax_rates_jurisdiction_from_to').on(
      t.jurisdictionId,
      t.effectiveFrom,
      t.effectiveTo,
    ),
  ],
)
