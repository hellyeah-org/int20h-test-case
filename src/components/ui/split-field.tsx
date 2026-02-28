import * as React from 'react'
import { cn } from '#/lib/utils'

interface SplitFieldProps {
  label: string
  left: React.ReactElement<{ className?: string }>
  right: React.ReactElement<{ className?: string }>
  className?: string
}

/**
 * Renders a labelled field containing two joined children.
 * The left child gets `rounded-r-none border-r-0 focus-within:z-10`,
 * the right child gets `rounded-l-none focus-within:z-10`.
 *
 * Usage:
 *   <SplitField
 *     label="Date from / to"
 *     left={<DatePickerField ... />}
 *     right={<DatePickerField ... />}
 *   />
 */
export function SplitField({ label, left, right, className }: SplitFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="text-sm font-medium">{label}</label>
      <div className="flex">
        {React.cloneElement(left, {
          className: cn(
            'rounded-r-none border-r-0 focus-within:z-10',
            left.props.className,
          ),
        })}
        {React.cloneElement(right, {
          className: cn('rounded-l-none focus-within:z-10', right.props.className),
        })}
      </div>
    </div>
  )
}
