import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['tests/workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            RELAY_TOKEN: 'relay_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
            ALLOWED_HOSTS: 'example.com',
          },
        },
      },
    },
  },
})
