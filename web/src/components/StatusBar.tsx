import { useAtlas } from '../state/store';

export function StatusBar() {
  const codes = useAtlas((s) => s.codes);
  const edges = useAtlas((s) => s.edges);
  const selectedId = useAtlas((s) => s.selectedId);
  const mode = useAtlas((s) => s.mode);
  const loadError = useAtlas((s) => s.loadError);
  const version = useAtlas((s) => s.version);
  const selectedIds = useAtlas((s) => s.selectedIds);
  // The Schema tab keeps its own counts on the canvas and has no connect mode,
  // so the code-centric readouts would only describe a view that is not on screen.
  const onSchema = useAtlas((s) => s.activeTab === 'tables');

  const selected = codes.find((n) => n.id === selectedId);

  return (
    <div className="statusbar">
      {onSchema ? (
        <span>
          <b>Schema</b> — tables and their columns
        </span>
      ) : (
        <>
          <span>
            <b>{codes.length}</b> codes
          </span>
          <span>
            <b>{edges.length}</b> edges
          </span>
          <span>
            <b>{selectedIds.size > 0 ? `${selectedIds.size} selected` : selected ? selected.name : 'no selection'}</b>
          </span>
        </>
      )}
      <span className="spacer" />
      {loadError && <span className="err">{loadError}</span>}
      {onSchema ? (
        <span>/ search · Enter next match · Shift+click or Shift+drag to select several · double-click opens a table</span>
      ) : (
        <>
          <span>mode: {mode}</span>
          <span>Shift+click or Shift+drag to select several · drag a handle to connect · right-click for actions</span>
        </>
      )}
      {/* Which build, and which file format it writes — the two numbers you need
          when a bundle from somewhere else will not import. */}
      {version && (
        <span title={`Writes .atlas.json format ${version.bundleVersion}, reads ${version.minBundleVersion} and up · Node ${version.node}`}>
          v{version.version} · file fmt {version.bundleVersion}
        </span>
      )}
    </div>
  );
}
