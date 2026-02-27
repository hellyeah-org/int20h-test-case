import { parse } from 'csv-parse/sync'
import { sql, type InferInsertModel } from 'drizzle-orm'
import { db } from '#/db/index'
import { identifierSystems } from '#/db/schema/tax'

type IdentifierInsert = Pick<
  InferInsertModel<typeof identifierSystems>,
  'key' | 'name'
>

async function seed() {
  try {
    const csvContent = await Bun.file(
      'src/datasets/identifier_systems.csv',
    ).text()

    const records: IdentifierInsert[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    })

    await db
      .insert(identifierSystems)
      .values(records)
      .onConflictDoUpdate({
        target: identifierSystems.key,
        set: {
          name: sql`excluded.name`,
          updatedAt: new Date(),
        },
      })
  } catch (error) {
    console.log('Error seeding database:', error)
  }
}

seed()
