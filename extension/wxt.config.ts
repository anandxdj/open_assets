import { defineConfig } from 'wxt';
import { hostPermissionsFor, resolveUrls } from './src/shared/urls';

// WXT loads `.env`, `.env.local`, `.env.<mode>` ... into process.env before it
// calls the `manifest` function below, and Vite inlines the same
// WXT_PUBLIC_* values into the bundle, so the URLs the code uses and the
// permissions the manifest asks for always come from the same place.
// @types/node is not a dependency of this package, so describe the one global used here.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // The version comes from package.json.
  manifest: () => {
    const urls = resolveUrls(process.env);
    // Optional: the public key from the Chrome Web Store dashboard (Package tab)
    // makes unpacked builds use the store extension ID, which the backend's
    // EXTENSION_ORIGINS has to list.
    const key = process.env.EXTENSION_PUBLIC_KEY?.trim();
    return {
      name: 'OpenAssets',
      description: 'Generate, extract, and organise image assets from your browser.',
      ...(key ? { key } : {}),
      icons: {
        '16': 'icons/icon16.png',
        '32': 'icons/icon32.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
      action: {
        default_icon: {
          '16': 'icons/icon16.png',
          '32': 'icons/icon32.png',
          '48': 'icons/icon48.png',
          '128': 'icons/icon128.png',
        },
      },
      permissions: ['activeTab', 'alarms', 'contextMenus', 'downloads', 'identity', 'sidePanel', 'scripting', 'storage'],
      host_permissions: hostPermissionsFor(urls),
      // Requested one site at a time, with a prompt, when the user picks an image on a page.
      optional_host_permissions: ['http://*/*', 'https://*/*'],
      commands: {
        'extract-image': {
          suggested_key: { default: 'Alt+Shift+E', mac: 'Alt+Shift+E' },
          description: 'Extract the last selected image',
        },
      },
    };
  },
});
