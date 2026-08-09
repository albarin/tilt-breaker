import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],

  // Firefox would default to MV2. Force MV3 on both so there is only one background
  // model to maintain.
  manifestVersion: 3,

  manifest: {
    name: 'Game limit — chess.com',
    description:
      'Set a daily per-time-class game quota on chess.com and keep extra blitz out of your rapid.',
    permissions: ['storage', 'alarms'],
    // In a tab rather than the small dialog: settings is a full form.
    options_ui: { open_in_tab: true },
    host_permissions: ['*://*.chess.com/*', 'https://api.chess.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'chess-limit@alba',
        // MV3 has been stable in Firefox since 109; 115 is the ESR and a comfortable floor.
        strict_min_version: '115.0',
        // Everything is stored locally and nothing is sent to a server of ours. Calls to
        // api.chess.com hit the site's own public API, with your own username.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
