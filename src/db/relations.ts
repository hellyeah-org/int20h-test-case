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
  },
  taxRates: {
    jurisdiction: r.one.jurisdictions({
      from: r.taxRates.jurisdictionId,
      to: r.jurisdictions.id,
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
}))
