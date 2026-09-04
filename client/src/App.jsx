import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import AuditTrail from './pages/AuditTrail';
import Metrics from './pages/Metrics';
import Detail from './pages/Detail';
import Landing from './pages/Landing';
import { SocketProvider, useSocketContext } from './hooks/SocketContext';
import { NowProvider } from './hooks/useNow';

function AppShell() {
  // One shared connection (see SocketProvider below) — the sidebar's
  // connection indicator and Dashboard's live feed both read from it.
  const { connected } = useSocketContext();

  return (
    // h-screen + overflow-hidden locks this wrapper to the viewport instead
    // of growing with its content — that's what makes the sidebar and main
    // content scroll independently below. Without this, the wrapper grows
    // to fit whatever's tallest (e.g. a long Queue table), the whole page
    // scrolls as one unit, and the sidebar scrolls away with it. No top bar
    // sits above this split — the sidebar already spans the full height.
    <div className="flex h-screen overflow-hidden bg-porcelain">
      <Sidebar connected={connected} />
      <main className="h-full flex-1 overflow-y-auto">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="queue" element={<Queue />} />
          <Route path="audit-trail" element={<AuditTrail />} />
          <Route path="metrics" element={<Metrics />} />
          <Route path="disputes/:id" element={<Detail />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      {/* No "already entered" flag persisted anywhere (deliberate — see
          Landing.jsx) — every fresh load of "/" shows the landing page.
          The socket connection only opens once you actually navigate into
          /app, not while sitting on the landing page. */}
      <Route path="/" element={<Landing />} />
      <Route
        path="/app/*"
        element={
          // feedLimit 50: the hook keeps more history than any one page
          // needs right now — Dashboard renders only the most recent 15.
          <SocketProvider feedLimit={50}>
            <NowProvider>
              <AppShell />
            </NowProvider>
          </SocketProvider>
        }
      />
    </Routes>
  );
}

export default App;
