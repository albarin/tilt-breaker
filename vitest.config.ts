import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Runes live in `.svelte.ts` modules too, and without the compiler `$state` there is
  // just an undefined global: the shared UI state would be the one layer nothing could test.
  plugins: [svelte(), WxtVitest()],
  // Svelte ships a server build and a browser one, and node conditions pick the server
  // one — where `mount` refuses to run. The pages under test are browser pages.
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Makes the storage double reject what a real browser rejects. See the file.
    setupFiles: ['./src/test-setup.ts'],
  },
});
