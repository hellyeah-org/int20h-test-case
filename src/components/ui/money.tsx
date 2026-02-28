import { cn } from '#/lib/utils'

interface MoneyProps {
  value: string | number
  currency?: string
  className?: string
}

export function Money({ value, currency = 'USD', className }: MoneyProps) {
  const amount = typeof value === 'string' ? parseFloat(value) : value
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {amount.toFixed(2)} {currency}
    </span>
  )
}
