/* @vitest-environment node */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => {
    const sql = (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values })
    return {
        sql,
        and: (...args: any[]) => ({ and: args }),
        or: (...args: any[]) => ({ or: args }),
        eq: (a: any, b: any) => ({ eq: [a, b] }),
        inArray: (a: any, b: any[]) => ({ inArray: [a, b] }),
        isNull: (a: any) => ({ isNull: a }),
        lte: (a: any, b: any) => ({ lte: [a, b] }),
        gt: (a: any, b: any) => ({ gt: [a, b] }),
    }
})

type AnyObj = Record<string, any>

const { mockDb, setSelectQueue, getInserted, forceTransactionError } = vi.hoisted(() => {
    // Queue of results for db.select().from().where() calls (in the exact order they happen)
    let selectQueue: any[] = []

    // Captured inserts (for assertions)
    let insertedOrderValues: AnyObj | null = null
    let insertedTaxLinesValues: AnyObj[] | null = null

    // Optional forced transaction error
    let transactionError: Error | null = null

    const setSelectQueue = (items: any[]) => {
        selectQueue = [...items]
        insertedOrderValues = null
        insertedTaxLinesValues = null
        transactionError = null
    }

    const forceTransactionError = (err: Error) => {
        transactionError = err
    }

    const getInserted = () => ({
        insertedOrderValues,
        insertedTaxLinesValues,
    })

    const makeSelectBuilder = () => ({
        from: (_table: any) => ({
            where: async (_cond: any) => {
                if (selectQueue.length === 0) return []
                return selectQueue.shift()
            },
        }),
    })

    const makeInsertBuilder = (table: any) => ({
        values: (vals: any) => {
            if (table?.__name === 'orders') {
                insertedOrderValues = vals
                return {
                    returning: async (_ret: any) => [{ id: '11111111-1111-1111-1111-111111111111' }],
                }
            }

            if (table?.__name === 'tax_lines') {
                insertedTaxLinesValues = Array.isArray(vals) ? vals : [vals]
                return Promise.resolve()
            }

            return {
                returning: async () => [{ id: '11111111-1111-1111-1111-111111111111' }],
            }
        },
    })

    const tx = {
        insert: (table: any) => makeInsertBuilder(table),
    }

    const mockDb = {
        select: vi.fn(() => makeSelectBuilder()),
        transaction: vi.fn(async (fn: any) => {
            if (transactionError) throw transactionError
            return fn(tx)
        }),
    }

    return { mockDb, setSelectQueue, getInserted, forceTransactionError }
})

vi.mock('#/db/index', () => ({ db: mockDb }))

vi.mock('#/db/schema/tax', () => {
    const col = (name: string) => ({ __col: name })
    const table = (name: string, cols: string[]) => {
        const t: any = { __name: name }
        for (const c of cols) t[c] = col(`${name}.${c}`)
        return t
    }

    return {
        jurisdictions: table('jurisdictions', ['id', 'name', 'kind', 'level', 'boundary']),
        taxRates: table('tax_rates', ['id', 'jurisdictionId', 'rate', 'effectiveFrom', 'effectiveTo']),
        orders: table('orders', [
            'id',
            'latitude',
            'longitude',
            'orderDate',
            'subtotalAmount',
            'compositeTaxRate',
            'taxAmount',
            'totalAmount',
            'createdAt',
        ]),
        taxLines: table('tax_lines', [
            'id',
            'taxRateId',
            'jurisdictionId',
            'orderId',
            'rate',
            'amount',
            'jurisdictionName',
            'jurisdictionKind',
            'jurisdictionLevel',
            'createdAt',
        ]),
    }
})

function makeJsonRequest(body: unknown) {
    return new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

function makeCsvRequest(csv: string) {
    return new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
    })
}

let postHandler: (args: { request: Request }) => Promise<Response>

beforeAll(async () => {
    // Import after mocks are registered
    const mod = await import('./orders')
    postHandler = (mod as any).Route.options.server.handlers.POST
})

describe('POST /api/orders (mocked DB)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('Happy path: computes composite tax, stores order and tax lines', async () => {
        // The endpoint does 3 selects in this order:
        // 1) ADMIN jurisdictions by point
        // 2) SPECIAL jurisdictions by point
        // 3) tax_rates by jurisdiction_ids and date
        setSelectQueue([
            // 1) ADMIN jurisdictions
            [
                { id: 'state-1', name: 'New York', kind: 'ADMINISTRATIVE', level: 10 },
                { id: 'county-1', name: 'Kings', kind: 'ADMINISTRATIVE', level: 20 },
                { id: 'city-1', name: 'NYC', kind: 'ADMINISTRATIVE', level: 30 },
            ],
            // 2) SPECIAL jurisdictions
            [{ id: 'spec-1', name: 'MCTD', kind: 'SPECIAL', level: null }],
            // 3) tax_rates
            [
                { id: 'tr-state', jurisdictionId: 'state-1', rate: '0.040000' },
                { id: 'tr-county', jurisdictionId: 'county-1', rate: '0.020000' },
                { id: 'tr-city', jurisdictionId: 'city-1', rate: '0.010000' },
                { id: 'tr-mctd', jurisdictionId: 'spec-1', rate: '0.003750' },
            ],
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [
                    {
                        latitude: 40.7128,
                        longitude: -74.006,
                        subtotal: 100,
                        timestamp: '2026-02-28T10:00:00Z',
                    },
                ],
            }),
        })

        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body.orders).toHaveLength(1)
        const o = body.orders[0]

        // 0.04 + 0.02 + 0.01 + 0.00375 = 0.07375
        expect(o.composite_tax_rate).toBeCloseTo(0.07375, 6)

        // 100 * 0.07375 = 7.375 -> rounds to 7.38
        expect(o.tax_amount).toBe(7.38)
        expect(o.total_amount).toBe(107.38)

        // Breakdown
        expect(o.breakdown.state_rate).toBeCloseTo(0.04, 6)
        expect(o.breakdown.county_rate).toBeCloseTo(0.02, 6)
        expect(o.breakdown.city_rate).toBeCloseTo(0.01, 6)
        expect(o.breakdown.special_rates).toHaveLength(1)
        expect(o.breakdown.special_rates[0].rate).toBeCloseTo(0.00375, 6)

        // DB inserts happened
        const { insertedOrderValues, insertedTaxLinesValues } = getInserted()
        expect(insertedOrderValues).toBeTruthy()
        expect(insertedTaxLinesValues).toBeTruthy()
        expect(insertedTaxLinesValues!.length).toBe(4)
    })

    it('Rounding: 49.99 with composite rate 0.07375 produces correct cents rounding', async () => {
        setSelectQueue([
            [{ id: 'state-1', name: 'New York', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr-state', jurisdictionId: 'state-1', rate: '0.073750' }],
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [
                    {
                        latitude: 40.0,
                        longitude: -74.0,
                        subtotal: 49.99,
                        timestamp: '2026-02-28T10:00:00Z',
                    },
                ],
            }),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        const o = body.orders[0]

        expect(o.composite_tax_rate).toBeCloseTo(0.07375, 6)
        // 49.99 * 0.07375 = 3.6867625 -> 3.69
        expect(o.tax_amount).toBe(3.69)
        expect(o.total_amount).toBe(53.68)
    })

    it('CSV: accepts CSV payload and returns 200', async () => {
        setSelectQueue([
            [{ id: 'state-1', name: 'New York', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr-state', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])

        const csv = `latitude,longitude,subtotal,timestamp
40.7128,-74.006,100,2026-02-28T10:00:00Z
`

        const res = await postHandler({ request: makeCsvRequest(csv) })
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.orders).toHaveLength(1)
    })

    it('Multiple orders: returns one result per input order', async () => {
        // Two orders => 6 selects (3 per order)
        setSelectQueue([
            // order 1
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
            // order 2
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [
                    { latitude: 40.7128, longitude: -74.006, subtotal: 100, timestamp: '2026-02-28T10:00:00Z' },
                    { latitude: 42.6526, longitude: -73.7562, subtotal: 50, timestamp: '2026-02-28T10:00:00Z' },
                ],
            }),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.orders).toHaveLength(2)
    })

    it('No tax rates found: returns composite_tax_rate=0 and does not insert tax_lines', async () => {
        setSelectQueue([
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [], // tax rates empty
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [{ latitude: 40.7128, longitude: -74.006, subtotal: 100, timestamp: '2026-02-28T10:00:00Z' }],
            }),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        const o = body.orders[0]

        expect(o.composite_tax_rate).toBe(0)
        expect(o.tax_amount).toBe(0)
        expect(o.total_amount).toBe(100)

        const { insertedTaxLinesValues } = getInserted()
        // should remain null/empty depending on your mock implementation
        expect(insertedTaxLinesValues == null || insertedTaxLinesValues.length === 0).toBe(true)
    })

    it('Only state rate exists: creates exactly one tax line', async () => {
        setSelectQueue([
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr-state', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [{ latitude: 40.7128, longitude: -74.006, subtotal: 100, timestamp: '2026-02-28T10:00:00Z' }],
            }),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.orders[0].composite_tax_rate).toBeCloseTo(0.04, 6)
        expect(body.orders[0].tax_amount).toBe(4)
        expect(body.orders[0].total_amount).toBe(104)

        const { insertedTaxLinesValues } = getInserted()
        expect(insertedTaxLinesValues).toBeTruthy()
        expect(insertedTaxLinesValues!.length).toBe(1)
    })

    it('Sums multiple tax_rates rows for the same jurisdiction', async () => {
        setSelectQueue([
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [
                { id: 'tr-a', jurisdictionId: 'state-1', rate: '0.020000' },
                { id: 'tr-b', jurisdictionId: 'state-1', rate: '0.020000' },
            ],
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [{ latitude: 40.7128, longitude: -74.006, subtotal: 100, timestamp: '2026-02-28T10:00:00Z' }],
            }),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        const o = body.orders[0]

        expect(o.composite_tax_rate).toBeCloseTo(0.04, 6)
        expect(o.tax_amount).toBe(4)
        expect(o.total_amount).toBe(104)
    })

    it('Validation: returns 400 on invalid input (subtotal < 0)', async () => {
        const res = await postHandler({
            request: makeJsonRequest({
                orders: [{ latitude: 0, longitude: 0, subtotal: -1, timestamp: '2026-02-28T10:00:00Z' }],
            }),
        })

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toBe('invalid_input')
    })

    it('Geo miss: returns 422 when no state jurisdiction is found', async () => {
        setSelectQueue([
            // ADMIN
            [],
            // SPECIAL
            [],
            // tax_rates (not used)
            [],
        ])

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [{ latitude: 10, longitude: 10, subtotal: 100, timestamp: '2026-02-28T10:00:00Z' }],
            }),
        })

        expect(res.status).toBe(422)
        const body = await res.json()
        expect(body.error).toBe('state_not_found_for_point')
    })

    it('DB failure: returns 500 when transaction throws', async () => {
        setSelectQueue([
            [{ id: 'state-1', name: 'New York', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr-state', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])
        forceTransactionError(new Error('db_down'))

        const res = await postHandler({
            request: makeJsonRequest({
                orders: [{ latitude: 40.7128, longitude: -74.006, subtotal: 100, timestamp: '2026-02-28T10:00:00Z' }],
            }),
        })

        expect(res.status).toBe(500)
        const body = await res.json()
        expect(body.error).toBe('db_down')
    })
})