import type { ReactNode } from 'react'

export function Page({ children }: { children: ReactNode }) {
  return <main className="app-page mx-auto w-full max-w-lg px-5">{children}</main>
}
