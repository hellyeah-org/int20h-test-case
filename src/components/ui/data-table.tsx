'use client'

import * as React from 'react'

import { Loader2 } from 'lucide-react'

import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  Row,
  SortingState,
  Table,
  VisibilityState,
} from '@tanstack/react-table'

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  Table as TableRoot,
  TableRow,
} from '#/components/ui/table'
import { Input } from '#/components/ui/input'
import { DataTablePagination } from '#/components/ui/data-table-pagination'

// Augment TanStack Table's ColumnMeta to support per-column className hints
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    /** Applied to both <TableHead> and <TableCell> */
    className?: string
    /** Applied only to <TableHead> (overrides className for the header cell) */
    headerClassName?: string
    /** Human-readable column label shown in the view options dropdown */
    label?: string
  }
}

interface DataTableProps<TData, TValue> {
  columns: Array<ColumnDef<TData, TValue>>
  data: Array<TData>
  filterColumn?: string
  rowCount?: number
  isFetching?: boolean
  manualPagination?: boolean
  manualSorting?: boolean
  manualFiltering?: boolean
  onPaginationChange?: React.Dispatch<
    React.SetStateAction<{ pageIndex: number; pageSize: number }>
  >
  onSortingChange?: React.Dispatch<React.SetStateAction<SortingState>>
  onColumnFiltersChange?: React.Dispatch<
    React.SetStateAction<ColumnFiltersState>
  >
  state?: {
    pagination?: { pageIndex: number; pageSize: number }
    sorting?: SortingState
    columnFilters?: ColumnFiltersState
    columnVisibility?: VisibilityState
    rowSelection?: Record<string, boolean>
  }
  /**
   * Render prop called every render with the live table instance.
   * Use this to render <DataTableViewOptions> outside the table.
   */
  toolbar?: (table: Table<TData>) => React.ReactNode
  /**
   * When provided, each row becomes expandable. This render prop receives the
   * row instance and should return the sub-component to display beneath it.
   */
  renderSubComponent?: (row: Row<TData>) => React.ReactNode
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterColumn,
  rowCount,
  isFetching,
  manualPagination,
  manualSorting,
  manualFiltering,
  onPaginationChange,
  onSortingChange,
  onColumnFiltersChange,
  state: externalState,
  toolbar,
  renderSubComponent,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  )
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})
  const [expanded, setExpanded] = React.useState<ExpandedState>({})

  // When data changes (new page, filter applied) and expanding is enabled,
  // reset so only the first row is expanded.
  React.useEffect(() => {
    if (!renderSubComponent || !data.length) return
    setExpanded({ '0': true })
  }, [data, renderSubComponent])

  const table = useReactTable({
    data,
    columns,
    rowCount,
    manualPagination,
    manualSorting,
    manualFiltering,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: !manualPagination
      ? getPaginationRowModel()
      : undefined,
    onPaginationChange,
    getSortedRowModel: !manualSorting ? getSortedRowModel() : undefined,
    onSortingChange: onSortingChange ?? setSorting,
    getFilteredRowModel: !manualFiltering ? getFilteredRowModel() : undefined,
    onColumnFiltersChange: onColumnFiltersChange ?? setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    // Expanding
    getRowCanExpand: renderSubComponent ? () => true : undefined,
    getExpandedRowModel: renderSubComponent ? getExpandedRowModel() : undefined,
    onExpandedChange: setExpanded,
    state: {
      sorting: externalState?.sorting ?? sorting,
      columnFilters: externalState?.columnFilters ?? columnFilters,
      columnVisibility: externalState?.columnVisibility ?? columnVisibility,
      rowSelection: externalState?.rowSelection ?? rowSelection,
      pagination: externalState?.pagination,
      expanded,
    },
  })

  return (
    <div className="space-y-4">
      {/* Optional external toolbar slot — receives live table each render */}
      {toolbar?.(table)}
      {filterColumn && (
        <Input
          className="max-w-sm"
          placeholder={`Filter ${filterColumn}...`}
          value={
            (table.getColumn(filterColumn)?.getFilterValue() as string) || ''
          }
          onChange={(event) =>
            table.getColumn(filterColumn)?.setFilterValue(event.target.value)
          }
        />
      )}
      <div className="bg-card rounded-md border">
        <TableRoot className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta
                  return (
                    <TableHead
                      key={header.id}
                      className={meta?.headerClassName ?? meta?.className}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isFetching ? (
              <TableRow>
                <TableCell className="h-24" colSpan={columns.length}>
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    className={renderSubComponent ? 'cursor-pointer' : undefined}
                    data-state={row.getIsSelected() && 'selected'}
                    onClick={() => renderSubComponent && row.toggleExpanded()}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cell.column.columnDef.meta?.className}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                  {renderSubComponent && row.getIsExpanded() && (
                    <tr>
                      <td
                        className="p-0"
                        colSpan={row.getVisibleCells().length}
                      >
                        {renderSubComponent(row)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="h-24 text-center"
                  colSpan={columns.length}
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TableRoot>
      </div>
      <DataTablePagination table={table} />
    </div>
  )
}
