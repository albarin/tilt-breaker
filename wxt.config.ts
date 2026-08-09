import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],

  // Firefox would default to MV2. Force MV3 on both so there is only one background
  // model to maintain.
  manifestVersion: 3,

  manifest: {
    name: 'Tilt Breaker',
    // No non-affiliation note here: this is the line shown in search results, and
    // spending a third of it on a disclaimer says nothing about what the thing does.
    // It goes in the store's detailed description instead, where reviewers look.
    description:
      'Stop the one-more-game spiral on chess.com: daily caps per game type, a cooldown between games, no rematch.',
    permissions: ['storage', 'alarms'],
    // In a tab rather than the small dialog: settings is a full form.
    options_ui: { open_in_tab: true },
    host_permissions: ['*://*.chess.com/*', 'https://api.chess.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'tilt-breaker@alba',
        // MV3 has been stable in Firefox since 109; 115 is the ESR and a comfortable floor.
        strict_min_version: '115.0',
        // Everything is stored locally and nothing is sent to a server of ours. Calls to
        // api.chess.com hit the site's own public API, with your own username.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
