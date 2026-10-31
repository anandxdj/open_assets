import { createRoot } from 'react-dom/client';
import { PanelRightOpen } from 'lucide-react';
import { callWorker } from '../shared/worker';
import { browser } from 'wxt/browser';
import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../shared/contracts';
import { Brand, Notice } from './components';
import '@fontsource-variable/jetbrains-mono';
import './oa.css';
import './styles.css';

function Popup() {
  const [app, setApp] = useState<AppSnapshot | null>(null);
  const refresh = () => callWorker({ type: 'APP_SNAPSHOT' }).then((result) => { if ('snapshot' in result) setApp(result.snapshot); });
  useEffect(() => { void refresh(); }, []);
  return <main className="ext-popup">
    <h1 className="oa-sr-only">OpenAssets</h1>
    <Brand />
    <p>{!app ? 'Checking your account…' : app.account ? `Connected as ${app.account.name}` : 'Sign in to unlock your image workspace.'}</p>
    {app?.account && app.notice && <Notice notice={app.notice} onDismiss={() => void callWorker({ type: 'DISMISS_NOTICE' }).then(refresh)} />}
    <button type="button" className="oa-btn oa-btn-primary oa-btn-block" onClick={() => void browser.sidePanel.open({ windowId: browser.windows.WINDOW_ID_CURRENT })}><PanelRightOpen aria-hidden="true" /> Open workspace</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
