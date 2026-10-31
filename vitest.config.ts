import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/mailqueue_test',
      DATABASE_SSL: 'false',
      API_KEY: 'test-api-key',
      RESEND_API_KEY: 're_test_placeholder',
      EMAIL_FROM: 'onboarding@resend.dev',
      ASNIHER_HEARTBEAT_URL: '',
    },
  },
});
