// Config Vitest — tests du moteur métier (tests/), dont les golden extraits
// de l'Excel de référence. Lancement : npm test (alias vitest run).
import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // même alias que tsconfig ("@/*" → racine du repo)
    alias: { "@": path.resolve(__dirname) },
  },
})
