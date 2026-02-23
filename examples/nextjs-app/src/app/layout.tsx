import type { Metadata } from "next"
import { Providers } from "./providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "effect-trpc Example",
  description: "Example Next.js app using effect-trpc",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <main className="min-h-screen bg-gray-50">
            <div className="container mx-auto py-8">
              <header className="mb-8">
                <h1 className="text-3xl font-bold text-center">
                  effect-trpc Example
                </h1>
                <p className="text-center text-gray-600 mt-2">
                  tRPC-style ergonomics for Effect-based applications
                </p>
              </header>
              {children}
            </div>
          </main>
        </Providers>
      </body>
    </html>
  )
}
