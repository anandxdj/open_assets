import { createRoot } from 'react-dom/client';
import { Box, PanelRightOpen } from 'lucide-react';
import { callWorker } from '../shared/worker';
import { browser } from 'wxt/browser';
import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../shared/contracts';
import './styles.css';

function Popup() {
  const [app, setApp] = useState<AppSnapshot | null>(null);
  useEffect(() => { void callWorker({ type: 'APP_SNAPSHOT' }).then((result) => 'snapshot' in result && setApp(result.snapshot)); }, []);
  return <main className="popup-shell">
    <div className="popup-brand"><Box size={18} /> <strong>OpenAssets</strong></div>
    <p>{app?.account ? `Connected as ${app.account.name}` : 'Sign in to unlock your image workspace.'}</p>
    <button className="primary" onClick={() => void browser.sidePanel.open({ windowId: browser.windows.WINDOW_ID_CURRENT })}><PanelRightOpen size={16} /> Open workspace</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
