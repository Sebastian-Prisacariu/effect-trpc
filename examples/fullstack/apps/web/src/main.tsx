import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { trpc } from "./trpc"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <trpc.Provider>
      <App />
    </trpc.Provider>
  </StrictMode>,
)
