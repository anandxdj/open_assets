import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-only harness for the popup and side panel (see harness/README.md).
 *
 * It is a plain Vite app rooted here. WXT only builds `entrypoints/`, so nothing
 * in this folder reaches `.output`. `pnpm harness` serves it; it is never part
 * of `pnpm build`.
 */

/** Index of the brace that closes the one opened at `open`. */
function closingBrace(css: string, open: number) {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) return i;
  }
  throw new Error('oa.css: unbalanced braces');
}

/**
 * oa.css follows the system colour scheme only. The harness wants a theme
 * switch, so this appends copies of the light and dark token blocks keyed on
 * `<html data-oa-theme>`. The source file is not modified and the extension
 * build does not use this plugin.
 */
function forcedThemes(): Plugin {
  return {
    name: 'oa-forced-themes',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]!.endsWith('/src/ui/oa.css')) return null;
      const media = code.indexOf('@media (prefers-color-scheme: dark)');
      const lightStart = code.indexOf(':root {');
      if (media < 0 || lightStart < 0) throw new Error('oa.css: token blocks not found');
      const mediaOpen = code.indexOf('{', media);
      const mediaClose = closingBrace(code, mediaOpen);
      const dark = code.slice(mediaOpen + 1, mediaClose).replaceAll(':root', ':root[data-oa-theme="dark"]');
      const light = code.slice(lightStart, closingBrace(code, code.indexOf('{', lightStart)) + 1).replace(':root', ':root[data-oa-theme="light"]');
      return `${code.slice(0, mediaClose + 1)}\n${dark}\n${light}${code.slice(mediaClose + 1)}`;
    },
  };
}

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  cacheDir: new URL('../node_modules/.vite-harness', import.meta.url).pathname,
  plugins: [forcedThemes()],
  esbuild: { jsx: 'automatic' },
  server: {
    // `*.localhost` names (one per agent or tab) resolve to loopback.
    allowedHosts: ['.localhost'],
    fs: { allow: [new URL('..', import.meta.url).pathname] },
  },
});
