import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Tests format and group by local day like the users in Belgium do; pin the zone so results do
// not depend on the machine (CI runners use UTC). Workers inherit it.
process.env.TZ = 'Europe/Brussels';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // Only the token file is read as CSS (the contrast test parses it); modules keep plain names.
      css: { include: [/tokens\.css/], modules: { classNameStrategy: 'non-scoped' } },
      restoreMocks: true,
      testTimeout: 15000,
    },
  }),
);
