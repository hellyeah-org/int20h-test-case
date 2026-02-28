'use client'

import { Eye, EyeOff, Settings2 } from 'lucide-react'
import type { Table } from '@tanstack/react-table'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'

export function DataTableViewOptions<TData>({
  table,
}: {
  table: Table<TData>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="ml-auto hidden h-8 lg:flex"
          size="sm"
          variant="outline"
        >
          <Settings2 className="mr-2 size-4" />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter(
            (column) =>
              typeof column.accessorFn !== 'undefined' && column.getCanHide(),
          )
          .map((column) => {
            const visible = column.getIsVisible()
            const label =
              column.columnDef.meta?.label ??
              column.id
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, (s) => s.toUpperCase())

            return (
              <DropdownMenuItem
                key={column.id}
                className="flex items-center gap-2"
                onSelect={(e) => {
                  e.preventDefault()
                  column.toggleVisibility(!visible)
                }}
              >
                {visible ? (
                  <Eye className="text-foreground size-4 shrink-0" />
                ) : (
                  <EyeOff className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className={cn(!visible && 'text-muted-foreground')}>
                  {label}
                </span>
              </DropdownMenuItem>
            )
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
