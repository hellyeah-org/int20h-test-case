import { defineRelations } from 'drizzle-orm'

import * as schema from './schema'

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session({
      from: r.user.id,
      to: r.session.userId,
    }),
    accounts: r.many.account({
      from: r.user.id,
      to: r.account.userId,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
    }),
  },
  jurisdictions: {
    taxRates: r.many.taxRates({
      from: r.jurisdictions.id,
      to: r.taxRates.jurisdictionId,
    }),
    identifiers: r.many.jurisdictionIdentifiers({
      from: r.jurisdictions.id,
      to: r.jurisdictionIdentifiers.jurisdictionId,
    }),
    taxLines: r.many.taxLines({
      from: r.jurisdictions.id,
      to: r.taxLines.jurisdictionId,
    }),
  },
  taxRates: {
    jurisdiction: r.one.jurisdictions({
      from: r.taxRates.jurisdictionId,
      to: r.jurisdictions.id,
    }),
    taxLines: r.many.taxLines({
      from: r.taxRates.id,
      to: r.taxLines.taxRateId,
    }),
  },
  identifierSystems: {
    identifiers: r.many.jurisdictionIdentifiers({
      from: r.identifierSystems.id,
      to: r.jurisdictionIdentifiers.systemId,
    }),
  },
  jurisdictionIdentifiers: {
    jurisdiction: r.one.jurisdictions({
      from: r.jurisdictionIdentifiers.jurisdictionId,
      to: r.jurisdictions.id,
    }),
    system: r.one.identifierSystems({
      from: r.jurisdictionIdentifiers.systemId,
      to: r.identifierSystems.id,
    }),
  },
  orders: {
    taxLines: r.many.taxLines({
      from: r.orders.id,
      to: r.taxLines.orderId,
    }),
  },
  taxLines: {
    order: r.one.orders({
      from: r.taxLines.orderId,
      to: r.orders.id,
    }),
    taxRate: r.one.taxRates({
      from: r.taxLines.taxRateId,
      to: r.taxRates.id,
    }),
    jurisdiction: r.one.jurisdictions({
      from: r.taxLines.jurisdictionId,
      to: r.jurisdictions.id,
    }),
  },
}))
