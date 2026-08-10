import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Runes live in `.svelte.ts` modules too, and without the compiler `$state` there is
  // just an undefined global: the shared UI state would be the one layer nothing could test.
  plugins: [svelte(), WxtVitest()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
