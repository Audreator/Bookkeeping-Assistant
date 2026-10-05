export type IconName = 'today' | 'ledger' | 'planner' | 'stats' | 'settings' | 'wallet' | 'plus' | 'close' | 'check' | 'minus' | 'chevron-left' | 'chevron-right'

const paths: Record<IconName, string[]> = {
  today: ['M3 10.5 12 3l9 7.5', 'M5 9v11h5v-6h4v6h5V9'],
  ledger: ['M6 3h12a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M8 3v18', 'M11 8h5', 'M11 12h5'],
  planner: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M7 3v4', 'M17 3v4', 'M3 10h18', 'm9 15 2 2 4-4'],
  stats: ['M4 20h17', 'M7 16V9', 'M12 16V4', 'M17 16v-5'],
  settings: ['M9 3h6l.6 3 2.5 1.4 2.9-1 3 5.2-2.3 2v2.8l2.3 2-3 5.2-2.9-1-2.5 1.4L15 27H9l-.6-3-2.5-1.4-2.9 1-3-5.2 2.3-2v-2.8L0 11.6l3-5.2 2.9 1L8.4 6 9 3Z'],
  wallet: ['M4 7V5a2 2 0 0 1 2-2h12v4', 'M4 7h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 1-2Z', 'M21 11h-6v6h6', 'M17 14h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  check: ['m5 12 4 4 10-10'],
  minus: ['M6 12h12'],
  'chevron-left': ['m15 5-7 7 7 7'],
  'chevron-right': ['m9 5 7 7-7 7'],
}

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  if (name === 'settings') {
    return <svg aria-hidden="true" className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9.5 3-.6 2.4-2 .9-2.3-.6L2 11l1.8 1.8.1 2.2-1.4 1.9 3.6 3.7 2-.9 2.1.6 1.3 1.7 5-.9.5-2.2 1.7-1.5 2.2-.1 1-5-1.8-1.3-.8-2.1.5-2.2-4.3-2.5-1.8 1.2-2.2.1L12 3Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  }
  return <svg aria-hidden="true" className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {paths[name].map((d) => <path key={d} d={d} />)}
  </svg>
}
