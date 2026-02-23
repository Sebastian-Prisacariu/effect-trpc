"use client"

import { trpc } from "~/lib/trpc"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <trpc.Provider>
      {children}
    </trpc.Provider>
  )
}
