/* @vitest-environment node */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => {
    const sql = (strings: TemplateStringsArray, ...values: any[]) => ({
        op: 'sql',
        text: strings.join(''),
        values,
    })
    return {
        sql,
        and: (...conditions: any[]) => ({ op: 'and', conditions }),
        or: (...conditions: any[]) => ({ op: 'or', conditions }),
        eq: (a: any, b: any) => ({ op: 'eq', a, b }),
        inArray: (a: any, b: any[]) => ({ op: 'inArray', a, b }),
        isNull: (a: any) => ({ op: 'isNull', a }),
        lte: (a: any, b: any) => ({ op: 'lte', a, b }),
        gt: (a: any, b: any) => ({ op: 'gt', a, b }),
    }
})

type AnyObj = Record<string, any>

const {
    mockDb,
    setSelectQueue,
    getInserted,
    getTxCount,
    resetState,
} = vi.hoisted(() => {
    let selectQueue: any[] = []

    let insertedOrderValues: AnyObj[] = []
    let insertedTaxLinesValues: AnyObj[] = []
    let txCount = 0
    let txError: Error | null = null

    const resetState = () => {
        selectQueue = []
        insertedOrderValues = []
        insertedTaxLinesValues = []
        txCount = 0
        txError = null
    }

    const setSelectQueue = (items: any[]) => {
        selectQueue = [...items]
    }

    const forceTransactionError = (err: Error) => {
        txError = err
    }

    const getInserted = () => ({
        insertedOrderValues,
        insertedTaxLinesValues,
    })

    const getTxCount = () => txCount

    function makeSelectChain(_selection: any) {
        const exec = async () => selectQueue.shift() ?? []
        const chain: any = {
            from(_table: any) {
                return chain
            },
            where(_cond: any) {
                return exec()
            },
            then(onFulfilled: any, onRejected: any) {
                return exec().then(onFulfilled, onRejected)
            },
        }
        return chain
    }

    function makeInsertBuilder(table: any) {
        return {
            values(vals: any) {
                if (table?.__name === 'orders') {
                    insertedOrderValues.push(vals)
                    return { returning: async () => [{ id: `order-${insertedOrderValues.length}` }] }
                }
                if (table?.__name === 'tax_lines') {
                    const arr = Array.isArray(vals) ? vals : [vals]
                    insertedTaxLinesValues.push(...arr)
                    return Promise.resolve()
                }
                return { returning: async () => [{ id: 'x' }] }
            },
        }
    }

    const mockDb = {
        select: vi.fn((selection: any) => makeSelectChain(selection)),
        transaction: vi.fn(async (fn: any) => {
            txCount++
            if (txError) throw txError
            const tx = { insert: (table: any) => makeInsertBuilder(table) }
            return fn(tx)
        }),
    }

    return {
        mockDb,
        setSelectQueue,
        getInserted,
        getTxCount,
        resetState,
        forceTransactionError,
    }
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
        orders: table('orders', ['id']),
        taxLines: table('tax_lines', ['id']),
    }
})

function makeCsvRequest(url: string, csv: string, contentType = 'text/csv') {
    return new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: csv,
    })
}

let postImport: (args: { request: Request }) => Promise<Response>

beforeAll(async () => {
    const mod = await import('./orders')
    postImport = (mod as any).postOrdersImport
    if (!postImport) throw new Error('postOrdersImport export is missing')
})

describe('postOrdersImport (same-file import logic)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetState()
    })

    it('DryRun CSV: imported=1, failed=0, does not call db.transaction', async () => {
        setSelectQueue([
            // ADMIN
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            // SPECIAL
            [],
            // tax_rates
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])

        const csv = `latitude,longitude,subtotal,timestamp
40.7128,-74.006,100,2026-02-28T10:00:00Z
`

        const res = await postImport({
            request: makeCsvRequest('http://localhost/api/orders/import?dryRun=true', csv),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.dryRun).toBe(true)
        expect(body.imported).toBe(1)
        expect(body.failed).toBe(0)
        expect(body.results).toHaveLength(1)
        expect(body.results[0].order_id).toBeNull()

        expect(getTxCount()).toBe(0)
        const { insertedOrderValues, insertedTaxLinesValues } = getInserted()
        expect(insertedOrderValues).toHaveLength(0)
        expect(insertedTaxLinesValues).toHaveLength(0)
    })

    it('Non-dryRun CSV: imported=1 and calls db.transaction once', async () => {
        setSelectQueue([
            // For calculateAndStoreOne:
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])

        const csv = `latitude,longitude,subtotal,timestamp
40.7128,-74.006,100,2026-02-28T10:00:00Z
`

        const res = await postImport({
            request: makeCsvRequest('http://localhost/api/orders/import', csv),
        })

        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body.dryRun).toBe(false)
        expect(body.imported).toBe(1)
        expect(body.failed).toBe(0)

        expect(getTxCount()).toBe(1)
    })

    it('Partial failure: second CSV row fails and reports correct row number', async () => {
        setSelectQueue([
            // row 1 OK (dryRun path)
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],

            // row 2 FAIL
            [],
            [],
            [],
        ])

        const csv = `latitude,longitude,subtotal,timestamp
40.7128,-74.006,100,2026-02-28T10:00:00Z
10,10,100,2026-02-28T10:00:00Z
`

        const res = await postImport({
            request: makeCsvRequest('http://localhost/api/orders/import?dryRun=true', csv),
        })

        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body.imported).toBe(1)
        expect(body.failed).toBe(1)
        expect(body.errors).toHaveLength(1)
        expect(body.errors[0].row).toBe(3) // header=1, first row=2, second row=3
        expect(body.errors[0].error).toBe('state_not_found_for_point')
    })

    it('maxReturn limits results length but keeps imported count', async () => {
        setSelectQueue([
            // row1
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
            // row2
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
            // row3
            [{ id: 'state-1', name: 'NY', kind: 'ADMINISTRATIVE', level: 10 }],
            [],
            [{ id: 'tr1', jurisdictionId: 'state-1', rate: '0.040000' }],
        ])

        const csv = `latitude,longitude,subtotal,timestamp
40.7128,-74.006,100,2026-02-28T10:00:00Z
40.7128,-74.006,100,2026-02-28T10:00:00Z
40.7128,-74.006,100,2026-02-28T10:00:00Z
`

        const res = await postImport({
            request: makeCsvRequest('http://localhost/api/orders/import?dryRun=true&maxReturn=1', csv),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.imported).toBe(3)
        expect(body.failed).toBe(0)
        expect(body.results).toHaveLength(1)
    })
})