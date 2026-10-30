import { createRoot } from 'react-dom/client';
import { PanelRightOpen } from 'lucide-react';
import { callWorker } from '../shared/worker';
import { browser } from 'wxt/browser';
import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../shared/contracts';
import { Brand } from './components';
import '@fontsource-variable/jetbrains-mono';
import './oa.css';
import './styles.css';

function Popup() {
  const [app, setApp] = useState<AppSnapshot | null>(null);
  useEffect(() => { void callWorker({ type: 'APP_SNAPSHOT' }).then((result) => 'snapshot' in result && setApp(result.snapshot)); }, []);
  return <main className="ext-popup">
    <Brand />
    <p>{app?.account ? `Connected as ${app.account.name}` : 'Sign in to unlock your image workspace.'}</p>
    <button type="button" className="oa-btn oa-btn-primary oa-btn-block" onClick={() => void browser.sidePanel.open({ windowId: browser.windows.WINDOW_ID_CURRENT })}><PanelRightOpen aria-hidden="true" /> Open workspace</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
