import { parse } from 'csv-parse/sync'
import { sql, type InferInsertModel, and, eq, isNull } from 'drizzle-orm'
import { db } from '#/db/index'
import {
  jurisdictions,
  jurisdictionIdentifiers,
  identifierSystems,
  taxRates,
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

type TaxRateCsvRecord = {
  jurisdiction_name: string
  tax_rate: string
  reporting_code: string
  level: string
  effective_from: string
  effective_to: string
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

async function seedTaxRates() {
  try {
    const systems = await db.select().from(identifierSystems)
    const reportingSys = systems.find((s) => s.key === 'nys_reporting_code')

    if (!reportingSys) throw new Error('NYS Reporting Code system not found')

    const csvContent = await Bun.file('datasets/ny_sales_tax_rates.csv').text()
    const records: TaxRateCsvRecord[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    })

    for (const record of records) {
      const targetLevel = record.level ? parseInt(record.level) : null

      const [jurisdiction] = await db
        .select({ id: jurisdictions.id })
        .from(jurisdictions)
        .where(
          and(
            eq(jurisdictions.name, record.jurisdiction_name),
            targetLevel
              ? eq(jurisdictions.level, targetLevel)
              : isNull(jurisdictions.level),
          ),
        )

      if (!jurisdiction) {
        console.warn(
          `Could not find jurisdiction: ${record.jurisdiction_name} (Level: ${record.level})`,
        )
        continue
      }

      if (record.reporting_code) {
        await db
          .insert(jurisdictionIdentifiers)
          .values({
            jurisdictionId: jurisdiction.id,
            systemId: reportingSys.id,
            valueRaw: record.reporting_code,
            valueNorm: record.reporting_code.toLowerCase().trim(),
          })
          .onConflictDoNothing()
      }

      await db.insert(taxRates).values({
        jurisdictionId: jurisdiction.id,
        rate: record.tax_rate,
        effectiveFrom: record.effective_from,
        effectiveTo: record.effective_to || null,
      })
    }
  } catch (error) {
    throw error
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_v, i) =>
    array.slice(i * size, i * size + size),
  )
}

async function runSeed() {
  try {
    await db.execute(sql`TRUNCATE TABLE jurisdictions RESTART IDENTITY CASCADE`)
    await db.execute(
      sql`TRUNCATE TABLE identifier_systems RESTART IDENTITY CASCADE`,
    )
    await seedIdentifierSystems()
    await seedSpatialData()
    await seedTaxRates()
  } catch (error) {
    console.log('Error seeding database:', error)
  }
}

runSeed()
