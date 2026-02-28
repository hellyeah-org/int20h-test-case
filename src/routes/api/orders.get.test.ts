/* @vitest-environment node */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Mock drizzle-orm primitives used by GET handler.
 * We return simple objects so we can assert "filters were included".
 */
vi.mock('drizzle-orm', () => {
    const sql = (strings: TemplateStringsArray, ...values: any[]) => ({
        op: 'sql',
        text: strings.join(''),
        strings: Array.from(strings),
        values,
    })

    return {
        sql,
        and: (...conditions: any[]) => ({ op: 'and', conditions }),
        or: (...conditions: any[]) => ({ op: 'or', conditions }),
        eq: (a: any, b: any) => ({ op: 'eq', a, b }),
        gte: (a: any, b: any) => ({ op: 'gte', a, b }),
        lte: (a: any, b: any) => ({ op: 'lte', a, b }),
        gt: (a: any, b: any) => ({ op: 'gt', a, b }),
        inArray: (a: any, b: any[]) => ({ op: 'inArray', a, b }),
        isNull: (a: any) => ({ op: 'isNull', a }),
        asc: (a: any) => ({ op: 'asc', a }),
        desc: (a: any) => ({ op: 'desc', a }),
    }
})

type QueryCall = {
    selection: any
    table?: any
    where?: any
    orderBy?: any
    limit?: number
    offset?: number
}

const { mockDb, setSelectQueue, getSelectCalls, resetCalls } = vi.hoisted(() => {
    let selectQueue: any[] = []
    let calls: QueryCall[] = []

    const setSelectQueue = (items: any[]) => {
        selectQueue = [...items]
        calls = []
    }

    const resetCalls = () => {
        calls = []
    }

    const getSelectCalls = () => calls

    function makeChain(selection: any) {
        const state: QueryCall = { selection }

        const exec = async () => {
            calls.push({ ...state })
            return selectQueue.shift() ?? []
        }

        const chain: any = {
            from(table: any) {
                state.table = table
                return chain
            },
            where(cond: any) {
                state.where = cond
                return chain
            },
            orderBy(ob: any) {
                state.orderBy = ob
                return chain
            },
            limit(n: number) {
                state.limit = n
                return chain
            },
            offset(n: number) {
                state.offset = n
                return exec()
            },
            then(onFulfilled: any, onRejected: any) {
                return exec().then(onFulfilled, onRejected)
            },
        }

        return chain
    }

    const mockDb = {
        select: vi.fn((selection: any) => makeChain(selection)),
        // GET handler won't use transaction; keep it present anyway
        transaction: vi.fn(async (fn: any) => fn({})),
    }

    return { mockDb, setSelectQueue, getSelectCalls, resetCalls }
})

vi.mock('#/db/index', () => ({ db: mockDb }))

/**
 * Minimal schema stubs. Only need columns referenced by GET.
 */
vi.mock('#/db/schema/tax', () => {
    const col = (name: string) => ({ __col: name })
    const table = (name: string, cols: string[]) => {
        const t: any = { __name: name }
        for (const c of cols) t[c] = col(`${name}.${c}`)
        return t
    }

    return {
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
            'updatedAt',
        ]),
        taxLines: table('tax_lines', [
            'id',
            'orderId',
            'taxRateId',
            'jurisdictionId',
            'jurisdictionName',
            'jurisdictionKind',
            'jurisdictionLevel',
            'rate',
            'amount',
            'createdAt',
        ]),
        // POST tables exist too, but not needed for GET tests
        jurisdictions: table('jurisdictions', ['id']),
        taxRates: table('tax_rates', ['id']),
    }
})

function makeGetRequest(url: string) {
    return new Request(url, { method: 'GET' })
}

let getHandler: (args: { request: Request }) => Promise<Response>

beforeAll(async () => {
    const mod = await import('./orders')
    getHandler = (mod as any).Route.options.server.handlers.GET
})

describe('GET /api/orders (mocked DB)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetCalls()
    })

    it('Returns a paginated list (page + pageSize + total + totalPages)', async () => {
        // count query result
        // items query result
        setSelectQueue([
            [{ count: 5 }],
            [
                {
                    id: 'o1',
                    latitude: '40.000000',
                    longitude: '-74.000000',
                    orderDate: '2026-02-10',
                    subtotalAmount: '100.00',
                    compositeTaxRate: '0.080000',
                    taxAmount: '8.00',
                    totalAmount: '108.00',
                    createdAt: '2026-02-10T10:00:00Z',
                    updatedAt: '2026-02-10T10:00:00Z',
                },
                {
                    id: 'o2',
                    latitude: '41.000000',
                    longitude: '-73.000000',
                    orderDate: '2026-02-11',
                    subtotalAmount: '50.00',
                    compositeTaxRate: '0.088750',
                    taxAmount: '4.44',
                    totalAmount: '54.44',
                    createdAt: '2026-02-11T10:00:00Z',
                    updatedAt: '2026-02-11T10:00:00Z',
                },
            ],
        ])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?page=2&pageSize=2'),
        })

        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.page).toBe(2)
        expect(body.pageSize).toBe(2)
        expect(body.total).toBe(5)
        expect(body.totalPages).toBe(3)
        expect(body.items).toHaveLength(2)

        // Ensure pagination values were applied on items query
        const calls = getSelectCalls()
        expect(calls.length).toBe(2)
        expect(calls[1].limit).toBe(2)
        expect(calls[1].offset).toBe(2)
    })

    it('Applies dateFrom/dateTo and sumFrom/sumTo filters', async () => {
        setSelectQueue([
            [{ count: 0 }],
            [],
        ])

        const res = await getHandler({
            request: makeGetRequest(
                'http://localhost/api/orders?dateFrom=2026-02-01&dateTo=2026-02-28&sumFrom=50&sumTo=200',
            ),
        })

        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        expect(calls.length).toBe(2)

        // filters are applied to count query (and items query)
        const where = calls[0].where
        expect(where).toBeTruthy()
        expect(where.op).toBe('and')

        // quick scan that required filters exist
        const ops = where.conditions.map((c: any) => c.op)
        expect(ops).toContain('gte') // dateFrom or sumFrom
        expect(ops).toContain('lte') // dateTo or sumTo

        // verify concrete values exist somewhere
        const values = where.conditions.flatMap((c: any) => [c.b]).filter(Boolean)
        expect(values).toContain('2026-02-01')
        expect(values).toContain('2026-02-28')
        expect(values).toContain('50')
        expect(values).toContain('200')
    })

    it('Supports includeLines=true and attaches tax_lines to each order', async () => {
        setSelectQueue([
            [{ count: 1 }],
            [
                {
                    id: 'o1',
                    latitude: '40.000000',
                    longitude: '-74.000000',
                    orderDate: '2026-02-10',
                    subtotalAmount: '100.00',
                    compositeTaxRate: '0.080000',
                    taxAmount: '8.00',
                    totalAmount: '108.00',
                    createdAt: '2026-02-10T10:00:00Z',
                    updatedAt: '2026-02-10T10:00:00Z',
                },
            ],
            [
                {
                    id: 'tl1',
                    orderId: 'o1',
                    taxRateId: 'tr1',
                    jurisdictionId: 'j1',
                    jurisdictionName: 'New York',
                    jurisdictionKind: 'ADMINISTRATIVE',
                    jurisdictionLevel: 10,
                    rate: '0.040000',
                    amount: '4.00',
                    createdAt: '2026-02-10T10:00:00Z',
                },
            ],
        ])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?includeLines=true&page=1&pageSize=10'),
        })

        expect(res.status).toBe(200)
        const body = await res.json()

        expect(body.items).toHaveLength(1)
        expect(body.items[0].tax_lines).toBeTruthy()
        expect(body.items[0].tax_lines).toHaveLength(1)
        expect(body.items[0].tax_lines[0].jurisdictionName).toBe('New York')
    })

    it('Supports hasSpecial=true filter (adds EXISTS condition)', async () => {
        setSelectQueue([
            [{ count: 0 }],
            [],
        ])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?hasSpecial=true'),
        })

        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        const where = calls[0].where
        expect(where).toBeTruthy()

        // At least one "sql" condition should exist with EXISTS keyword
        const sqlConds = where.conditions.filter((c: any) => c.op === 'sql')
        expect(sqlConds.length).toBeGreaterThan(0)
        expect(sqlConds.some((c: any) => c.text.includes('EXISTS'))).toBe(true)
    })

    it('Applies sort=totalAsc (uses asc(totalAmount))', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?sort=totalAsc'),
        })
        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        expect(calls.length).toBe(2)

        const orderBy = calls[1].orderBy
        expect(orderBy).toBeTruthy()
        expect(orderBy.op).toBe('asc')
        // should sort by orders.totalAmount
        expect(orderBy.a.__col).toContain('orders.totalAmount')
    })

    it('Applies sort=orderDateDesc (uses desc(orderDate))', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?sort=orderDateDesc'),
        })
        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        const orderBy = calls[1].orderBy
        expect(orderBy.op).toBe('desc')
        expect(orderBy.a.__col).toContain('orders.orderDate')
    })

    it('Applies minRate/maxRate filters', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?minRate=0.05&maxRate=0.09'),
        })
        expect(res.status).toBe(200)

        const where = getSelectCalls()[0].where
        expect(where.op).toBe('and')

        const conds = where.conditions
        expect(conds.some((c: any) => c.op === 'gte' && String(c.b) === '0.05')).toBe(true)
        expect(conds.some((c: any) => c.op === 'lte' && String(c.b) === '0.09')).toBe(true)
    })

    it('Applies jurisdictionName filter (adds EXISTS ... ILIKE %name%)', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?jurisdictionName=New%20York'),
        })
        expect(res.status).toBe(200)

        const where = getSelectCalls()[0].where
        expect(where.op).toBe('and')

        const sqlConds = where.conditions.filter((c: any) => c.op === 'sql')
        expect(sqlConds.length).toBeGreaterThan(0)
        expect(sqlConds.some((c: any) => c.text.includes('ILIKE'))).toBe(true)
    })

    it('Applies jurisdictionKind filter (adds EXISTS ... jurisdiction_kind = ...)', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?jurisdictionKind=SPECIAL'),
        })
        expect(res.status).toBe(200)

        const where = getSelectCalls()[0].where
        const sqlConds = where.conditions.filter((c: any) => c.op === 'sql')
        expect(sqlConds.length).toBeGreaterThan(0)
    })

    it('Applies jurisdictionLevel filter (adds EXISTS ... jurisdiction_level = 20)', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?jurisdictionLevel=20'),
        })
        expect(res.status).toBe(200)

        const where = getSelectCalls()[0].where
        const sqlConds = where.conditions.filter((c: any) => c.op === 'sql')
        expect(sqlConds.length).toBeGreaterThan(0)
    })

    it('Applies hasSpecial=false filter (adds NOT EXISTS)', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?hasSpecial=false'),
        })
        expect(res.status).toBe(200)

        const where = getSelectCalls()[0].where
        const sqlConds = where.conditions.filter((c: any) => c.op === 'sql')
        expect(sqlConds.length).toBeGreaterThan(0)
        expect(sqlConds.some((c: any) => c.text.includes('NOT EXISTS'))).toBe(true)
    })

    it('Pagination: page=1,pageSize=20 => offset=0,limit=20', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?page=1&pageSize=20'),
        })
        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        expect(calls[1].limit).toBe(20)
        expect(calls[1].offset).toBe(0)
    })

    it('Pagination: page=3,pageSize=10 => offset=20,limit=10', async () => {
        setSelectQueue([[{ count: 0 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?page=3&pageSize=10'),
        })
        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        expect(calls[1].limit).toBe(10)
        expect(calls[1].offset).toBe(20)
    })

    it('Returns correct totalPages when total=21 and pageSize=10 (totalPages=3)', async () => {
        setSelectQueue([[{ count: 21 }], []])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?page=1&pageSize=10'),
        })
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.total).toBe(21)
        expect(body.totalPages).toBe(3)
    })

    it('Returns 400 when pageSize > 100', async () => {
        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?page=1&pageSize=1000'),
        })
        expect(res.status).toBe(400)

        const body = await res.json()
        expect(body.error).toBe('invalid_query')
    })

    it('Returns 400 when jurisdictionLevel is invalid (e.g. 25)', async () => {
        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?jurisdictionLevel=25'),
        })
        expect(res.status).toBe(400)

        const body = await res.json()
        expect(body.error).toBe('invalid_query')
    })

    it('includeLines=true performs a third DB select for tax lines', async () => {
        setSelectQueue([
            [{ count: 1 }],
            [
                {
                    id: 'o1',
                    latitude: '40.000000',
                    longitude: '-74.000000',
                    orderDate: '2026-02-10',
                    subtotalAmount: '100.00',
                    compositeTaxRate: '0.080000',
                    taxAmount: '8.00',
                    totalAmount: '108.00',
                    createdAt: '2026-02-10T10:00:00Z',
                    updatedAt: '2026-02-10T10:00:00Z',
                },
            ],
            [
                {
                    id: 'tl1',
                    orderId: 'o1',
                    taxRateId: 'tr1',
                    jurisdictionId: 'j1',
                    jurisdictionName: 'New York',
                    jurisdictionKind: 'ADMINISTRATIVE',
                    jurisdictionLevel: 10,
                    rate: '0.040000',
                    amount: '4.00',
                    createdAt: '2026-02-10T10:00:00Z',
                },
            ],
        ])

        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?includeLines=true'),
        })
        expect(res.status).toBe(200)

        const calls = getSelectCalls()
        expect(calls.length).toBe(3) // count + items + tax_lines
    })

    it('Returns 400 on invalid query (bad date format)', async () => {
        const res = await getHandler({
            request: makeGetRequest('http://localhost/api/orders?dateFrom=02-28-2026'),
        })

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toBe('invalid_query')
    })
})