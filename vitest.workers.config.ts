import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          RELAY_TOKEN: 'relay_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
          ALLOWED_HOSTS: 'example.com',
        },
      },
    }),
  ],
  test: {
    include: ['tests/workers/**/*.test.ts'],
  },
})
