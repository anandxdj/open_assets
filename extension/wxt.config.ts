import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OpenAssets',
    description: 'Generate, extract, and organise image assets from your browser.',
    version: '2.0.0',
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    permissions: ['activeTab', 'alarms', 'contextMenus', 'downloads', 'identity', 'sidePanel', 'scripting', 'storage'],
    host_permissions: ['https://chatgpt.com/*', 'https://openassets.anands.dev/*', 'https://openasset-backend.anands.dev/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      'extract-image': {
        suggested_key: { default: 'Alt+Shift+E', mac: 'Alt+Shift+E' },
        description: 'Extract the last selected image',
      },
    },
  },
});
