'use client'

import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format, parseISO } from 'date-fns'
import { ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'

import type { OrdersSearch } from '#/lib/orders.functions'
import { Route } from '#/routes/_protected/index'
import { ordersQueryOptions } from '#/lib/orders.queries'
import { CreateOrderDialog } from '#/components/orders/create-order-dialog'
import { ImportCsvDialog } from '#/components/orders/import-csv-dialog'
import { TaxLinesPanel } from '#/components/orders/tax-lines-panel'
import { DataTable } from '#/components/ui/data-table'
import { DataTableColumnHeader } from '#/components/ui/data-table-column-header'
import { DataTableViewOptions } from '#/components/ui/data-table-view-options'
import { Money } from '#/components/ui/money'
import { Percentage } from '#/components/ui/percentage'
import { Button } from '#/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '#/components/ui/input-group'
import { Calendar } from '#/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Card, CardContent } from '#/components/ui/card'
import { SplitField } from '#/components/ui/split-field'
import { cn } from '#/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type Order = {
  id: string
  latitude: string
  longitude: string
  orderDate: string
  subtotalAmount: string
  compositeTaxRate: string
  taxAmount: string
  totalAmount: string
  createdAt: Date
  updatedAt: Date
}

// ─── Filter state ─────────────────────────────────────────────────────────────

interface FilterState {
  id: string
  dateFrom: string // 'yyyy-MM-dd' or ''
  dateTo: string // 'yyyy-MM-dd' or ''
  subtotalMin: string
  subtotalMax: string
}

function searchToFilterState(search: OrdersSearch): FilterState {
  return {
    id: search.id ?? '',
    dateFrom: search.dateFrom ?? '',
    dateTo: search.dateTo ?? '',
    subtotalMin:
      search.subtotalMin !== undefined ? String(search.subtotalMin) : '',
    subtotalMax:
      search.subtotalMax !== undefined ? String(search.subtotalMax) : '',
  }
}

const emptyFilters: FilterState = {
  id: '',
  dateFrom: '',
  dateTo: '',
  subtotalMin: '',
  subtotalMax: '',
}

function hasActiveFilters(f: FilterState) {
  return (
    f.id !== '' ||
    f.dateFrom !== '' ||
    f.dateTo !== '' ||
    f.subtotalMin !== '' ||
    f.subtotalMax !== ''
  )
}

function filtersEqual(a: FilterState, b: FilterState) {
  return (
    a.id === b.id &&
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo &&
    a.subtotalMin === b.subtotalMin &&
    a.subtotalMax === b.subtotalMax
  )
}

// ─── DatePickerField ──────────────────────────────────────────────────────────

interface DatePickerFieldProps {
  placeholder: string
  value: string // 'yyyy-MM-dd' or ''
  onChange: (v: string) => void
  className?: string
}

function DatePickerField({
  placeholder,
  value,
  onChange,
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false)
  const selected = value ? parseISO(value) : undefined

  return (
    <InputGroup className={cn('w-36', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              'h-full flex-1 justify-start rounded-none px-3 font-normal shadow-none focus-visible:ring-0 focus-visible:outline-none',
              !value && 'text-muted-foreground',
            )}
            data-slot="input-group-control"
            type="button"
            variant="ghost"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.closest('form')?.requestSubmit()
              }
            }}
          >
            {value ? format(parseISO(value), 'MMM d, yyyy') : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            initialFocus
            mode="single"
            selected={selected}
            onSelect={(day) => {
              onChange(day ? format(day, 'yyyy-MM-dd') : '')
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label="Clear date"
            data-slot="input-group-control"
            size="icon-xs"
            onClick={() => onChange('')}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

// ─── SplitDatePicker ──────────────────────────────────────────────────────────

interface SplitDatePickerProps {
  label: string
  fromValue: string
  toValue: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}

function SplitDatePicker({
  label,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
}: SplitDatePickerProps) {
  return (
    <SplitField
      label={label}
      left={
        <DatePickerField
          placeholder="From"
          value={fromValue}
          onChange={onFromChange}
        />
      }
      right={
        <DatePickerField
          placeholder="To"
          value={toValue}
          onChange={onToChange}
        />
      }
    />
  )
}

// ─── SplitNumberRange ─────────────────────────────────────────────────────────

interface SplitNumberRangeProps {
  label: string
  minValue: string
  maxValue: string
  onMinChange: (v: string) => void
  onMaxChange: (v: string) => void
  onCommit: () => void
}

function SplitNumberRange({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  onCommit,
}: SplitNumberRangeProps) {
  return (
    <SplitField
      label={label}
      left={
        <InputGroup className="w-28">
          <InputGroupInput
            min={0}
            placeholder="Min"
            type="number"
            value={minValue}
            onChange={(e) => onMinChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCommit()}
          />
          {minValue && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="Clear min"
                size="icon-xs"
                onClick={() => onMinChange('')}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      }
      right={
        <InputGroup className="w-28">
          <InputGroupInput
            min={0}
            placeholder="Max"
            type="number"
            value={maxValue}
            onChange={(e) => onMaxChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCommit()}
          />
          {maxValue && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="Clear max"
                size="icon-xs"
                onClick={() => onMaxChange('')}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      }
    />
  )
}

// ─── Columns ──────────────────────────────────────────────────────────────────

const RIGHT_CELL = 'text-right'
const RIGHT_HEADER = 'text-right [&>div]:justify-end'

const columns: Array<ColumnDef<Order>> = [
  // ── Expand toggle ────────────────────────────────────────────────────────
  {
    id: 'expand',
    meta: {
      className: 'w-8 px-1',
      headerClassName: 'w-8 px-1',
    },
    header: ({ table }) => (
      <button
        aria-label={
          table.getIsAllRowsExpanded() ? 'Collapse all rows' : 'Expand all rows'
        }
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded transition-colors"
        type="button"
        onClick={table.getToggleAllRowsExpandedHandler()}
      >
        {table.getIsAllRowsExpanded() ? (
          <ChevronDownIcon className="size-4" />
        ) : (
          <ChevronRightIcon className="size-4" />
        )}
      </button>
    ),
    cell: ({ row }) => (
      <button
        aria-label={row.getIsExpanded() ? 'Collapse row' : 'Expand row'}
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded transition-colors"
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          row.getToggleExpandedHandler()()
        }}
      >
        {row.getIsExpanded() ? (
          <ChevronDownIcon className="size-4" />
        ) : (
          <ChevronRightIcon className="size-4" />
        )}
      </button>
    ),
  },
  {
    accessorKey: 'id',
    meta: {
      label: 'Order ID',
      className: 'w-[280px] max-w-[280px]',
      headerClassName: 'w-[280px] max-w-[280px]',
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Order ID" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.getValue<string>('id')}</span>
    ),
  },
  {
    accessorKey: 'orderDate',
    meta: { label: 'Order Date', className: 'w-[120px]' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    enableSorting: true,
  },
  {
    accessorKey: 'latitude',
    meta: { label: 'Latitude', className: 'w-[110px]' },
    header: 'Latitude',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {parseFloat(row.getValue('latitude')).toFixed(4)}
      </span>
    ),
  },
  {
    accessorKey: 'longitude',
    meta: { label: 'Longitude', className: 'w-[110px]' },
    header: 'Longitude',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {parseFloat(row.getValue('longitude')).toFixed(4)}
      </span>
    ),
  },
  {
    accessorKey: 'subtotalAmount',
    meta: {
      label: 'Subtotal',
      className: RIGHT_CELL,
      headerClassName: `w-[140px] ${RIGHT_HEADER}`,
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Subtotal" />
    ),
    enableSorting: true,
    cell: ({ row }) => <Money value={row.getValue('subtotalAmount')} />,
  },
  {
    accessorKey: 'compositeTaxRate',
    meta: { label: 'Tax Rate', className: 'w-[110px]' },
    header: 'Tax Rate',
    cell: ({ row }) => <Percentage value={row.getValue('compositeTaxRate')} />,
  },
  {
    accessorKey: 'taxAmount',
    meta: {
      label: 'Tax',
      className: RIGHT_CELL,
      headerClassName: `w-[130px] ${RIGHT_HEADER}`,
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Tax" />
    ),
    cell: ({ row }) => <Money value={row.getValue('taxAmount')} />,
  },
  {
    accessorKey: 'totalAmount',
    meta: {
      label: 'Total',
      className: RIGHT_CELL,
      headerClassName: `w-[140px] ${RIGHT_HEADER}`,
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Total" />
    ),
    enableSorting: true,
    cell: ({ row }) => <Money value={row.getValue('totalAmount')} />,
  },
]

// ─── Main component ───────────────────────────────────────────────────────────

export function OrdersDataTable() {
  // URL search params — read-only, used for initialization and back/forward sync
  const search = Route.useSearch()
  const navigate = useNavigate()

  // committed: the last applied query state — drives useQuery key directly.
  // Updating this immediately starts a new fetch without waiting for the router.
  const [committed, setCommitted] = React.useState<OrdersSearch>(search)

  // filters: draft state for the filter form inputs — does NOT drive the query.
  const [filters, setFilters] = React.useState<FilterState>(() =>
    searchToFilterState(search),
  )

  // Sync both committed and draft filters when the URL changes externally
  // (browser back/forward). This is a legitimate useEffect use case — an
  // external event (history navigation) driving local state.
  React.useEffect(() => {
    setCommitted(search)
    setFilters(searchToFilterState(search))
  }, [search])

  const { data, isFetching } = useQuery({
    ...ordersQueryOptions(committed),
    placeholderData: keepPreviousData,
  })

  function setField<K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function applyFilters() {
    const committedFilters = searchToFilterState(committed)
    if (filtersEqual(filters, committedFilters)) return
    const next: OrdersSearch = {
      ...committed,
      id: filters.id || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      subtotalMin:
        filters.subtotalMin !== ''
          ? parseFloat(filters.subtotalMin)
          : undefined,
      subtotalMax:
        filters.subtotalMax !== ''
          ? parseFloat(filters.subtotalMax)
          : undefined,
      page: 1,
    }
    setCommitted(next)
    navigate({ to: '.', search: next })
  }

  function clearAllFilters() {
    // Reset draft inputs only. Does not commit or navigate.
    setFilters(emptyFilters)
  }

  // Derived state
  const committedFilters = searchToFilterState(committed)
  const filtersMatchCommitted = filtersEqual(filters, committedFilters)
  const filtersActive = hasActiveFilters(filters)
  const sorting: SortingState = [
    { id: committed.sortBy, desc: committed.sortDir === 'desc' },
  ]
  const pagination = {
    pageIndex: committed.page - 1,
    pageSize: committed.pageSize,
  }

  return (
    <DataTable
      manualFiltering
      manualPagination
      manualSorting
      columns={columns}
      data={(data?.rows ?? []) as Array<Order>}
      isFetching={isFetching}
      renderSubComponent={(row) => <TaxLinesPanel orderId={row.original.id} />}
      rowCount={data?.total ?? 0}
      state={{ pagination, sorting }}
      toolbar={(table) => (
        <>
          {/* Title + actions bar */}
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
            <div className="flex items-center gap-2">
              <DataTableViewOptions table={table} />
              <ImportCsvDialog />
              <CreateOrderDialog />
            </div>
          </div>

          {/* Filter card */}
          <Card>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  applyFilters()
                }}
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  {/* Left: filter inputs */}
                  <div className="flex flex-wrap items-end gap-3">
                    {/* Order ID */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">Order ID</label>
                      <InputGroup className="w-52">
                        <InputGroupInput
                          placeholder="Search by ID"
                          value={filters.id}
                          onChange={(e) => setField('id', e.target.value)}
                        />
                        {filters.id && (
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              aria-label="Clear ID"
                              size="icon-xs"
                              onClick={() => setField('id', '')}
                            >
                              <XIcon />
                            </InputGroupButton>
                          </InputGroupAddon>
                        )}
                      </InputGroup>
                    </div>

                    {/* Date from / to */}
                    <SplitDatePicker
                      fromValue={filters.dateFrom}
                      label="Date from / to"
                      toValue={filters.dateTo}
                      onFromChange={(v) => setField('dateFrom', v)}
                      onToChange={(v) => setField('dateTo', v)}
                    />

                    {/* Subtotal range */}
                    <SplitNumberRange
                      label="Subtotal"
                      maxValue={filters.subtotalMax}
                      minValue={filters.subtotalMin}
                      onCommit={applyFilters}
                      onMaxChange={(v) => setField('subtotalMax', v)}
                      onMinChange={(v) => setField('subtotalMin', v)}
                    />
                  </div>

                  {/* Right: action buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={!filtersActive}
                      type="button"
                      variant="secondary"
                      onClick={clearAllFilters}
                    >
                      Clear all
                    </Button>
                    <Button disabled={filtersMatchCommitted} type="submit">
                      Apply
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      )}
      onPaginationChange={(updater) => {
        const next =
          typeof updater === 'function' ? updater(pagination) : updater
        const nextSearch: OrdersSearch = {
          ...committed,
          page: next.pageIndex + 1,
          pageSize: next.pageSize,
        }
        setCommitted(nextSearch)
        navigate({ to: '.', search: nextSearch })
      }}
      onSortingChange={(updater) => {
        const next = typeof updater === 'function' ? updater(sorting) : updater
        const first = next[0]
        const nextSearch: OrdersSearch = {
          ...committed,
          sortBy: (first?.id as OrdersSearch['sortBy']) ?? 'orderDate',
          sortDir: first?.desc ? 'desc' : 'asc',
          page: 1,
        }
        setCommitted(nextSearch)
        navigate({ to: '.', search: nextSearch })
      }}
    />
  )
}
