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
    check(
      'chk_jurisdictions_name_not_blank',
      sql`${t.name} = btrim(${t.name}) AND ${t.name} <> ''`,
    ),
    check(
      'chk_jurisdictions_admin_requires_level',
      sql`${t.kind} <> 'ADMINISTRATIVE' OR ${t.level} IS NOT NULL`,
    ),
    check(
      'chk_jurisdictions_level_allowed',
      sql`${t.level} IS NULL OR ${t.level} IN (10, 20, 30)`,
    ),
    check(
      'chk_jurisdictions_boundary_not_empty',
      sql`NOT ST_IsEmpty(${t.boundary})`,
    ),
    check('chk_jurisdictions_boundary_valid', sql`ST_IsValid(${t.boundary})`),
    check(
      'chk_jurisdictions_boundary_srid_4326',
      sql`ST_SRID(${t.boundary}) = 4326`,
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
    check(
      'chk_identifier_systems_key_not_blank',
      sql`${t.key} = btrim(${t.key}) AND ${t.key} <> ''`,
    ),
    check(
      'chk_identifier_systems_name_not_blank',
      sql`${t.name} = btrim(${t.name}) AND ${t.name} <> ''`,
    ),
    check('chk_identifier_systems_key_lower', sql`${t.key} = lower(${t.key})`),
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
      sql`${t.valueRaw} = btrim(${t.valueRaw}) AND ${t.valueRaw} <> ''`,
    ),
    check(
      'chk_jurisdiction_identifiers_value_norm_not_blank',
      sql`${t.valueNorm} = btrim(${t.valueNorm}) AND ${t.valueNorm} <> ''`,
    ),
    check(
      'chk_jurisdiction_identifiers_scope_not_blank',
      sql`${t.scope} IS NULL OR (${t.scope} = btrim(${t.scope}) AND ${t.scope} <> '')`,
    ),
    check(
      'chk_jurisdiction_identifiers_value_norm_lower',
      sql`${t.valueNorm} = lower(${t.valueNorm})`,
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
      'chk_tax_rates_rate_fraction_range',
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

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    latitude: decimal('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: decimal('longitude', { precision: 9, scale: 6 }).notNull(),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    subtotalAmount: decimal('subtotal_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),
    compositeTaxRate: decimal('composite_tax_rate', {
      precision: 10,
      scale: 6,
    }).notNull(),
    taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull(),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
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
      'chk_orders_lat_range',
      sql`${t.latitude} >= -90 AND ${t.latitude} <= 90`,
    ),
    check(
      'chk_orders_lon_range',
      sql`${t.longitude} >= -180 AND ${t.longitude} <= 180`,
    ),
    check('chk_orders_subtotal_non_negative', sql`${t.subtotalAmount} >= 0`),
    check('chk_orders_tax_non_negative', sql`${t.taxAmount} >= 0`),
    check(
      'chk_orders_total_consistency',
      sql`${t.totalAmount} = ${t.subtotalAmount} + ${t.taxAmount}`,
    ),
    check(
      'chk_orders_rate_range',
      sql`${t.compositeTaxRate} >= 0 AND ${t.compositeTaxRate} <= 1`,
    ),
    index('idx_orders_order_date').on(t.orderDate),
  ],
)

export const taxLines = pgTable(
  'tax_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, {
      onDelete: 'set null',
    }),
    jurisdictionId: uuid('jurisdiction_id').references(() => jurisdictions.id, {
      onDelete: 'set null',
    }),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    rate: decimal('rate', { precision: 10, scale: 6 }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    jurisdictionName: text('jurisdiction_name').notNull(),
    jurisdictionKind: jurisdictionKindEnum('jurisdiction_kind').notNull(),
    jurisdictionLevel: smallint('jurisdiction_level'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_tax_lines_order').on(t.orderId),
    index('idx_tax_lines_jurisdiction').on(t.jurisdictionId),
    check('chk_tax_lines_amount_non_negative', sql`${t.amount} >= 0`),
    check('chk_tax_lines_rate_range', sql`${t.rate} >= 0 AND ${t.rate} <= 1`),
    check(
      'chk_tax_lines_jurisdiction_name_not_blank',
      sql`${t.jurisdictionName} = btrim(${t.jurisdictionName}) AND ${t.jurisdictionName} <> ''`,
    ),

    check(
      'chk_tax_lines_admin_requires_level',
      sql`${t.jurisdictionKind} <> 'ADMINISTRATIVE' OR ${t.jurisdictionLevel} IS NOT NULL`,
    ),
    check(
      'chk_tax_lines_level_allowed',
      sql`${t.jurisdictionLevel} IS NULL OR ${t.jurisdictionLevel} IN (10, 20, 30)`,
    ),
    uniqueIndex('uq_tax_lines_order_tax_rate')
      .on(t.orderId, t.taxRateId)
      .where(sql`${t.taxRateId} IS NOT NULL`),
  ],
)
