import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    alias: {
      // Vitest doesn't handle static asset imports by default.
      // This regex catches common image/font/media extensions and maps them
      // to a trivial module that exports an empty string.
      '\\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)$': new URL(
        './src/test/fileMock.ts',
        import.meta.url,
      ).pathname,
    },
  },
})
