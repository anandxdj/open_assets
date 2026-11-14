import { fixtures } from './fixtures';

/**
 * Control page: pick a fixture, theme and width; the popup and the side panel
 * render side by side in iframes of /frame.html. Each frame is also usable on
 * its own at a fixed viewport size (see the README).
 */
const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'signed-in-empty';
const theme = params.get('theme') ?? 'auto';
const width = params.get('width') ?? '400';
const height = params.get('height') ?? '760';

document.documentElement.style.colorScheme = theme === 'auto' ? 'light dark' : theme;
const root = document.getElementById('root')!;
root.innerHTML = `
  <style>
    body { margin: 0; font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; background: Canvas; color: CanvasText; }
    form { display: flex; flex-wrap: wrap; gap: 12px 20px; padding: 12px 16px; border-bottom: 1px solid GrayText; position: sticky; top: 0; background: Canvas; z-index: 1; }
    label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; text-transform: uppercase; }
    select, input, button { font: inherit; }
    main { display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; padding: 16px; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    figcaption { font-size: 11px; text-transform: uppercase; }
    iframe { border: 1px solid GrayText; background: Canvas; display: block; }
  </style>
  <form method="get">
    <label>State<select name="state">${fixtures.map((fixture) => `<option value="${fixture.id}"${fixture.id === state ? ' selected' : ''}>${fixture.label}</option>`).join('')}</select></label>
    <label>Theme<select name="theme">${['auto', 'light', 'dark'].map((value) => `<option${value === theme ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
    <label>Panel width<select name="width">${['320', '360', '400', '480'].map((value) => `<option${value === width ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
    <label>Panel height<input name="height" type="number" value="${height}" min="400" max="1200" step="20" /></label>
    <label>&nbsp;<button type="submit">Apply</button></label>
  </form>
  <main>
    <figure>
      <figcaption>Side panel ${width} x ${height}</figcaption>
      <iframe title="Side panel" width="${width}" height="${height}" src="/frame.html?surface=sidepanel&state=${state}&theme=${theme}"></iframe>
    </figure>
    <figure>
      <figcaption>Popup</figcaption>
      <iframe id="popup" title="Popup" width="300" height="140" src="/frame.html?surface=popup&state=${state}&theme=${theme}"></iframe>
    </figure>
  </main>`;

// The popup sizes itself to its content in Chrome; do the same for its frame.
const popup = document.getElementById('popup') as HTMLIFrameElement;
popup.addEventListener('load', () => {
  const fit = () => { const body = popup.contentDocument?.body; if (body) popup.height = String(body.scrollHeight); };
  fit();
  setTimeout(fit, 300);
});
