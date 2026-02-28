'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { taxLinesQueryOptions } from '#/lib/tax-lines.queries'
import type { TaxLine } from '#/lib/tax-lines.functions'
import { Money } from '#/components/ui/money'
import { Percentage } from '#/components/ui/percentage'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jurisdictionTypeLabel(
  kind: TaxLine['jurisdictionKind'],
  level: TaxLine['jurisdictionLevel'],
): string {
  if (kind === 'SPECIAL') return 'Special'
  switch (level) {
    case 10:
      return 'State'
    case 20:
      return 'County'
    case 30:
      return 'City'
    default:
      return 'Other'
  }
}

// ─── Column widths — must mirror the parent orders table exactly ──────────────
//
// Parent columns (left → right):
//   expand        32px   (prepended toggle column)
//   id           280px
//   orderDate    120px
//   latitude     110px
//   longitude    110px
//   subtotalAmt  140px   ← name cell ends here
//   taxRate      110px   ← "rate" cell aligns here
//   taxAmount    130px   ← "amount" cell aligns here
//   totalAmount  140px   ← empty trailing cell
//
// The sub-table lives inside a <td colSpan={n}> that starts at x=0, so we
// need an explicit 32px indent cell to skip the expand column, then the name
// cell covers id + date + lat + lng + subtotal so its left edge aligns with
// the "Order ID" text in the parent row.

const COL_EXPAND = 32
const COL_ID = 280
const COL_DATE = 120
const COL_LAT = 110
const COL_LNG = 110
const COL_SUBTOTAL = 140
const COL_RATE = 110
const COL_TAX = 130
const COL_TOTAL = 140

// Name cell width = id + date + lat + lng + subtotal (expand is a separate leading cell)
const NAME_SPAN_PX = COL_ID + COL_DATE + COL_LAT + COL_LNG + COL_SUBTOTAL

// ─── Component ────────────────────────────────────────────────────────────────

interface TaxLinesPanelProps {
  orderId: string
}

export function TaxLinesPanel({ orderId }: TaxLinesPanelProps) {
  const { data, isLoading } = useQuery(taxLinesQueryOptions(orderId))

  return (
    <div className="bg-muted/30 border-t px-0 py-1">
      {isLoading ? (
        <div className="flex h-10 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.length ? (
        <div className="text-muted-foreground px-4 py-2 text-xs">
          No tax lines found.
        </div>
      ) : (
        <table
          aria-label="Tax breakdown by jurisdiction"
          style={{ tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}
        >
          <colgroup>
            {/* indent — mirrors the parent's expand toggle column */}
            <col style={{ width: COL_EXPAND }} />
            {/* name — id + date + lat + lng + subtotal */}
            <col style={{ width: NAME_SPAN_PX }} />
            {/* rate — aligns under "Tax Rate" header */}
            <col style={{ width: COL_RATE }} />
            {/* amount — aligns under "Tax" header */}
            <col style={{ width: COL_TAX }} />
            {/* trailing — aligns under "Total" header */}
            <col style={{ width: COL_TOTAL }} />
          </colgroup>
          <thead>
            <tr>
              {/* indent cell */}
              <th style={{ width: COL_EXPAND }} />
              <th
                className="text-muted-foreground px-2 pb-1 pt-1.5 text-left text-xs font-medium"
                style={{ width: NAME_SPAN_PX }}
              >
                Jurisdiction
              </th>
              <th
                className="text-muted-foreground px-2 pb-1 pt-1.5 text-left text-xs font-medium"
                style={{ width: COL_RATE }}
              >
                Rate
              </th>
              <th
                className="text-muted-foreground px-2 pb-1 pt-1.5 text-right text-xs font-medium"
                style={{ width: COL_TAX }}
              >
                Amount
              </th>
              <th style={{ width: COL_TOTAL }} />
            </tr>
          </thead>
          <tbody>
            {data.map((line) => (
              <tr
                key={line.id}
                className="border-t border-border/40 last:border-b-0"
              >
                {/* indent cell — aligns with parent expand button column */}
                <td style={{ width: COL_EXPAND }} />
                {/* Jurisdiction name + type badge */}
                <td className="px-2 py-1.5 text-xs" style={{ width: NAME_SPAN_PX }}>
                  <span className="mr-2">{line.jurisdictionName}</span>
                  <span className="text-muted-foreground rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                    {jurisdictionTypeLabel(line.jurisdictionKind, line.jurisdictionLevel)}
                  </span>
                </td>
                {/* Rate — aligns under "Tax Rate" */}
                <td className="px-2 py-1.5 text-xs" style={{ width: COL_RATE }}>
                  <Percentage value={line.rate} />
                </td>
                {/* Amount — aligns under "Tax" */}
                <td className="px-2 py-1.5 text-right text-xs" style={{ width: COL_TAX }}>
                  <Money value={line.amount} />
                </td>
                {/* Empty trailing cell */}
                <td style={{ width: COL_TOTAL }} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
