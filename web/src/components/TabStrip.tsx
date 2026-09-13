import { useAtlas } from '../state/store';

/** Flow draws the pipeline's codes, Schema draws its tables. The two views are
 * permanent and always first; everything after them is a document someone
 * opened, which is why only those carry a colour dot and a close button. */
function ViewGlyph({ kind }: { kind: 'graph' | 'tables' }) {
  if (kind === 'graph') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="3.4" cy="8" r="1.9" />
        <circle cx="12.6" cy="8" r="1.9" />
        <path d="M5.3 8h5.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.3" />
      <path d="M2.5 6.4h11M7 6.4V13" />
    </svg>
  );
}

export function TabStrip() {
  const tabs = useAtlas((s) => s.tabs);
  const activeTab = useAtlas((s) => s.activeTab);
  const setActiveTab = useAtlas((s) => s.setActiveTab);
  const closeTab = useAtlas((s) => s.closeTab);
  const pipelines = useAtlas((s) => s.pipelines);
  const activePipeline = useAtlas((s) => s.activePipeline);
  const pipelineName = pipelines.find((p) => p.id === activePipeline)?.name;

  return (
    <div className="tabstrip" role="tablist">
      {tabs.map((tab) => {
        const view = tab.kind === 'graph' || tab.kind === 'tables';
        return (
          <div
            key={tab.id}
            className={view ? 'tab view' : 'tab'}
            role="tab"
            aria-selected={activeTab === tab.id}
            title={view && pipelineName ? `${tab.label} · ${pipelineName}` : undefined}
          >
            {!view && <span className="dot" style={{ background: tab.color }} />}
            <span className="tab-hit" onClick={() => setActiveTab(tab.id)}>
              {view && <ViewGlyph kind={tab.kind as 'graph' | 'tables'} />}
              {tab.label}
            </span>
            {!view && (
              <button className="x" aria-label={`Close ${tab.label}`} onClick={() => closeTab(tab.id)}>
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
