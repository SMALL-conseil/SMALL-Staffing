// Config Vitest — tests du moteur métier (tests/), dont les golden extraits
// de l'Excel de référence. Lancement : npm test (alias vitest run).
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    // même alias que tsconfig ("@/*" → racine du repo)
    alias: { "@": import.meta.dirname },
  },
})
