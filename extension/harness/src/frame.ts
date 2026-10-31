import { fixtureById, type Step } from './fixtures';
import { installChromeStub } from './stub';

/**
 * One extension page (popup or side panel) with a stubbed `chrome.*`.
 *   /frame.html?surface=sidepanel|popup&state=<fixture id>&theme=auto|light|dark
 * `theme=auto` follows the browser's colour scheme (the real extension does the
 * same); light and dark force it through <html data-oa-theme>.
 */
const params = new URLSearchParams(location.search);
const surface = params.get('surface') === 'popup' ? 'popup' : 'sidepanel';
const fixture = fixtureById(params.get('state'));
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.oaTheme = theme;
if (surface === 'sidepanel') document.body.classList.add('ext-sidepanel');

installChromeStub(fixture);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(find: () => T | null | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = find();
    if (found) return found;
    await wait(30);
  }
  throw new Error('harness: element not found');
}

const byName = (selector: string, name: string) => [...document.querySelectorAll<HTMLElement>(selector)]
  .find((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().toLowerCase().includes(name.toLowerCase()));

async function run(step: Step) {
  if ('click' in step) (await until(() => byName('button, a', step.click))).click();
  else if ('tab' in step) (await until(() => byName('[role="tab"]', step.tab))).click();
  else {
    const input = await until(() => document.querySelector<HTMLInputElement>(step.into));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, step.type);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

void (async () => {
  await import(surface === 'popup' ? '../../src/ui/popup' : '../../src/ui/sidepanel');
  // The popup has no tabs, forms or extract button, so it replays nothing.
  const steps: Step[] = surface === 'popup' ? [] : [...(fixture.tab ? [{ tab: fixture.tab }] : []), ...(fixture.drive ?? [])];
  if (fixture.snapshot === null) return;
  for (const step of steps) {
    try { await run(step); } catch (error) { console.warn(error); }
    await wait(60);
  }
  document.documentElement.dataset.harnessReady = 'true';
})();
