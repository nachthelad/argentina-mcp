import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/**/*.properties.ts'], testTimeout: 30000 } })
