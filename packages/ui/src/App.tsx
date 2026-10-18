import { useEffect, type ReactElement } from 'react';
import { useApp } from './store';
import { BottomNav, Sidebar, TopBar } from './components/Sidebar';
import { Spinner, Toasts } from './components/ui';
import { Welcome } from './pages/Welcome';
import { CreateWallet } from './pages/CreateWallet';
import { RestoreWallet } from './pages/RestoreWallet';
import { ImportKey } from './pages/ImportKey';
import { Unlock } from './pages/Unlock';
import { Overview } from './pages/Overview';
import { Send } from './pages/Send';
import { Receive } from './pages/Receive';
import { ActivityPage } from './pages/Activity';
import { Mining } from './pages/Mining';
import { Contacts } from './pages/Contacts';
import { SettingsPage } from './pages/Settings';
import { Terms } from './pages/Terms';
import { NodePage } from './pages/Node';

export function App() {
  const booted = useApp((s) => s.booted);
  const route = useApp((s) => s.route);
  const overview = useApp((s) => s.overview);
  const boot = useApp((s) => s.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!booted) {
    return (
      <div className="onboard" style={{ alignItems: 'center' }}>
        <Spinner large />
      </div>
    );
  }

  let page: ReactElement;
  switch (route.name) {
    case 'terms':
      page = <Terms />;
      break;
    case 'welcome':
      page = <Welcome />;
      break;
    case 'create':
      page = <CreateWallet />;
      break;
    case 'restore':
      page = <RestoreWallet />;
      break;
    case 'import':
      page = <ImportKey />;
      break;
    case 'unlock':
      page = <Unlock walletId={route.walletId} />;
      break;
    case 'overview':
      page = <Overview />;
      break;
    case 'send':
      page = <Send initialTo={route.to} />;
      break;
    case 'receive':
      page = <Receive />;
      break;
    case 'activity':
      page = <ActivityPage openTxid={route.txid} />;
      break;
    case 'mining':
      page = <Mining />;
      break;
    case 'node':
      page = <NodePage />;
      break;
    case 'contacts':
      page = <Contacts />;
      break;
    case 'settings':
      page = <SettingsPage initialTab={route.tab} />;
      break;
  }

  const inWallet = !!overview && !['terms', 'welcome', 'create', 'restore', 'import', 'unlock'].includes(route.name);
  return (
    <>
      {inWallet ? (
        <div className="app">
          <Sidebar />
          <TopBar />
          <main className="main">
            <div className="page">
              <div className="page-inner">{page}</div>
            </div>
          </main>
          <BottomNav />
        </div>
      ) : (
        page
      )}
      <Toasts />
    </>
  );
}
