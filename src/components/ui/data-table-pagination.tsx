import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import type { Table } from '@tanstack/react-table'

import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

interface DataTablePaginationProps<TData> {
  table: Table<TData>
}

export function DataTablePagination<TData>({
  table,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination
  const pageCount = table.getPageCount()
  const currentPage = pageIndex + 1

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Left side: rows-per-page select + row range */}
      <div className="flex items-center gap-3">
        <Select
          value={`${pageSize}`}
          onValueChange={(value) => table.setPageSize(Number(value))}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue placeholder={pageSize} />
          </SelectTrigger>
          <SelectContent side="top">
            {[10, 20, 50, 100].map((size) => (
              <SelectItem key={size} value={`${size}`}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          rows per page
        </span>
      </div>

      {/* Right side: page X of Y + first/prev/next/last buttons */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {currentPage} of {pageCount} pages
        </span>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Go to first page"
            className="size-8"
            disabled={!table.getCanPreviousPage()}
            size="icon"
            variant="ghost"
            onClick={() => table.setPageIndex(0)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            aria-label="Go to previous page"
            className="size-8"
            disabled={!table.getCanPreviousPage()}
            size="icon"
            variant="ghost"
            onClick={() => table.previousPage()}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            aria-label="Go to next page"
            className="size-8"
            disabled={!table.getCanNextPage()}
            size="icon"
            variant="ghost"
            onClick={() => table.nextPage()}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            aria-label="Go to last page"
            className="size-8"
            disabled={!table.getCanNextPage()}
            size="icon"
            variant="ghost"
            onClick={() => table.setPageIndex(pageCount - 1)}
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
