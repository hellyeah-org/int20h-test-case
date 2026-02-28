import { cn } from '#/lib/utils'

interface PercentageProps {
  value: string | number
  decimals?: number
  className?: string
}

export function Percentage({ value, decimals = 4, className }: PercentageProps) {
  const ratio = typeof value === 'string' ? parseFloat(value) : value
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {(ratio * 100).toFixed(decimals)}&thinsp;%
    </span>
  )
}
