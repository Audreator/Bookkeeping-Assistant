import { formatMoney } from '../lib/dates'

export function Money({
  value,
  className = '',
  signed = false,
}: {
  value: number
  className?: string
  signed?: boolean
}) {
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : ''
  return (
    <span className={className}>
      {sign}¥{formatMoney(Math.abs(value))}
    </span>
  )
}
