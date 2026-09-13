import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { GraphCanvas } from './components/GraphCanvas';
import { SearchRail } from './components/SearchRail';
import { Inspector } from './components/Inspector';
import { TopBar } from './components/TopBar';
import { TabStrip } from './components/TabStrip';
import { StatusBar } from './components/StatusBar';
import { ContextMenu } from './components/ContextMenu';
import { ToastView } from './components/ToastView';
import { FlowPane } from './panes/FlowPane';
import { SchemaPane } from './panes/SchemaPane';
import { SchemaCanvas } from './components/SchemaCanvas';
import { useAtlas } from './state/store';

/** True when a keystroke belongs to whatever the user is typing in, not to the app. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function App() {
  const status = useAtlas((s) => s.status);
  const loadError = useAtlas((s) => s.loadError);
  const tabs = useAtlas((s) => s.tabs);
  const activeTab = useAtlas((s) => s.activeTab);
  const selectedId = useAtlas((s) => s.selectedId);
  const load = useAtlas((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useAtlas.getState();

      if (event.key === 'Escape') {
        state.openMenu(null);
        state.cancelConnect();
        // The code selection belongs to the Flow tab; Esc on the Schema tab clears
        // that tab's own picked tables and must not reach across and drop it.
        if (state.activeTab !== 'tables') state.clearMultiSelect();
        return;
      }
      if (isTyping(event.target)) return;

      if (event.key === '/') {
        event.preventDefault();
        // Each view has its own search: on the Schema tab it finds tables and
        // columns; everywhere else it jumps to the rail's code search.
        if (state.activeTab === 'tables') {
          document.getElementById('schema-search')?.focus();
          return;
        }
        state.setActiveTab('graph');
        document.getElementById('atlas-search')?.focus();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The code shortcuts act on the selected code, which the Schema tab does not
      // show — a stray "d" there would duplicate something off-screen.
      if (state.activeTab === 'tables') return;

      const selected = state.selectedId;
      switch (event.key) {
        case 'v':
        case 'V':
          state.setMode('select');
          break;
        case 'c':
        case 'C':
          // Prevented unconditionally: startConnect focuses the rail search
          // right away, and an un-prevented keydown still delivers this same
          // keystroke to whatever now has focus, leaking a stray "c" into it.
          event.preventDefault();
          if (selected) state.startConnect(selected);
          else state.setMode('connect');
          break;
        case 'd':
          if (selected) void state.duplicate(selected, false);
          break;
        case 'D':
          if (selected) void state.duplicate(selected, true);
          break;
        case 'Enter':
          if (selected && state.activeTab === 'graph') state.openFlowTab(selected);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (status === 'loading') {
    return (
      <div className="boot">
        <span className="rail-label">Lineage Atlas</span>
        <span>Loading the graph…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="boot">
        <span className="rail-label">Lineage Atlas</span>
        <span>{loadError}</span>
        <button className="btn" onClick={() => void load()}>
          Retry
        </button>
        <span style={{ fontSize: 11 }}>
          Start the API with <span className="kbd">npm run dev</span> from the project root.
        </span>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <TabStrip />

      <div className="stage">
        {/* The graph pane stays mounted so the viewport survives a trip to a doc tab.
            With nothing selected the inspector has nothing to say, so it gives its
            column back to the canvas rather than sitting there empty. */}
        <div className={`pane pane-graph${selectedId ? '' : ' no-inspector'}`} hidden={activeTab !== 'graph'}>
          <SearchRail />
          <ReactFlowProvider>
            <GraphCanvas />
          </ReactFlowProvider>
          {selectedId && <Inspector />}
        </div>

        {/* The Schema tab is a view of the same pipeline, so it stays mounted too —
            its viewport, layout and any column being traced survive a tab switch. */}
        <div className="pane pane-tables" hidden={activeTab !== 'tables'}>
          <ReactFlowProvider>
            <SchemaCanvas active={activeTab === 'tables'} />
          </ReactFlowProvider>
        </div>

        {tabs
          .filter((tab) => tab.kind === 'flow' || tab.kind === 'schema')
          .map((tab) => (
            <div className="pane" key={tab.id} hidden={activeTab !== tab.id}>
              {tab.kind === 'flow' ? <FlowPane codeId={tab.refId!} /> : <SchemaPane assetId={tab.refId!} />}
            </div>
          ))}
      </div>

      <StatusBar />
      <ContextMenu />
      <ToastView />
    </div>
  );
}
