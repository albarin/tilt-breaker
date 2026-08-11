import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte', '@wxt-dev/i18n/module'],

  // Firefox would default to MV2. Force MV3 on both so there is only one background
  // model to maintain.
  manifestVersion: 3,

  manifest: {
    // Both come from the catalogues, so the store listing is translated along with the
    // extension. The English text lives in `src/locales/en.yml`, which is why the note
    // about the description belongs there too: it is the line shown in search results,
    // and spending a third of it on a non-affiliation disclaimer says nothing about what
    // the thing does. That goes in the store's detailed description, where reviewers look.
    name: '__MSG_extension_name__',
    description: '__MSG_extension_description__',
    // Required for `__MSG_*__` to resolve at all, and the fallback when the browser runs
    // in a language we do not ship.
    default_locale: 'en',
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
