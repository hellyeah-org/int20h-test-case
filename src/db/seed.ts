import { parse } from 'csv-parse/sync'
import { sql, type InferInsertModel } from 'drizzle-orm'
import { db } from '#/db/index'
import {
  jurisdictions,
  jurisdictionIdentifiers,
  identifierSystems,
} from '#/db/schema/tax'

type IdentifierInsert = Pick<
  InferInsertModel<typeof identifierSystems>,
  'key' | 'name'
>

type GeoFeature = {
  properties: {
    NAME: string
    FIPS_CODE?: string
  }
  geometry: Record<string, unknown>
}

async function seedIdentifierSystems() {
  try {
    const csvContent = await Bun.file('datasets/identifier_systems.csv').text()

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
    throw error
  }
}

async function seedSpatialData() {
  const systems = await db.select().from(identifierSystems)
  const fipsSys = systems.find((s) => s.key === 'fips')

  if (!fipsSys) throw new Error('FIPS identifier system not found')

  const layers = [
    { path: 'datasets/state.json', level: 10 },
    { path: 'datasets/counties.json', level: 20 },
    { path: 'datasets/cities.json', level: 30 },
  ]

  for (const layer of layers) {
    const file = Bun.file(layer.path)
    if (!(await file.exists())) continue

    const { features } = await file.json()
    const chunks = chunkArray(features as GeoFeature[], 100)

    for (const chunk of chunks) {
      await db.transaction(async (tx) => {
        for (const feature of chunk) {
          const { NAME, FIPS_CODE } = feature.properties

          const [inserted] = await tx
            .insert(jurisdictions)
            .values({
              name: NAME,
              kind: 'ADMINISTRATIVE',
              level: layer.level as any,
              boundary: sql`
                ST_Multi(
                    ST_Transform(
                    ST_SetSRID(
                        ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}),
                        32618
                    ),
                    4326
                    )
                )
                `,
            })
            .returning({ id: jurisdictions.id })

          if (FIPS_CODE) {
            await tx.insert(jurisdictionIdentifiers).values({
              jurisdictionId: inserted.id,
              systemId: fipsSys.id,
              valueRaw: String(FIPS_CODE),
              valueNorm: String(FIPS_CODE).trim(),
            })
          }
        }
      })
    }
  }

  const manifestFile = Bun.file('datasets/special_manifest.json')
  if (await manifestFile.exists()) {
    const specialManifest = await manifestFile.json()

    for (const spec of specialManifest) {
      const memberList = sql.join(
        spec.member_fips.map((f: string) => sql`${f}`),
        sql`, `,
      )

      await db.insert(jurisdictions).values({
        name: spec.name,
        kind: 'SPECIAL',
        level: null,
        boundary: sql`
          ST_Multi(
            ST_Union(
              ARRAY(
                SELECT j.boundary 
                FROM jurisdictions j
                JOIN jurisdiction_identifiers ji ON j.id = ji.jurisdiction_id
                WHERE ji.system_id = ${fipsSys.id}
                AND ji.value_norm IN (${memberList})
              )
            )
          )
        `,
      })
    }
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_v, i) =>
    array.slice(i * size, i * size + size),
  )
}

async function runSeed() {
  try {
    await seedIdentifierSystems()
    await seedSpatialData()
  } catch (error) {
    console.log('Error seeding database:', error)
  }
}

runSeed()
