import { useEffect, useRef, useState } from 'react';
import { useAtlas } from '../state/store';

export function PipelineMenu() {
  const pipelines = useAtlas((s) => s.pipelines);
  const activePipeline = useAtlas((s) => s.activePipeline);
  const selectPipeline = useAtlas((s) => s.selectPipeline);
  const newPipeline = useAtlas((s) => s.newPipeline);
  const renamePipeline = useAtlas((s) => s.renamePipeline);
  const removePipeline = useAtlas((s) => s.removePipeline);
  const exportPipeline = useAtlas((s) => s.exportPipeline);
  const importPipelineFiles = useAtlas((s) => s.importPipelineFiles);
  const relink = useAtlas((s) => s.relink);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ mode: 'new' | 'rename'; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = pipelines.find((p) => p.id === activePipeline);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setDraft(null);
        setConfirmDelete(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const submitDraft = () => {
    if (!draft?.value.trim()) return setDraft(null);
    if (draft.mode === 'new') void newPipeline(draft.value);
    else void renamePipeline(activePipeline, draft.value);
    setDraft(null);
    setOpen(false);
  };

  return (
    <div className="pipe" ref={wrapRef}>
      <button className="pipe-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title="Pipelines — new, open, import, export">
        <span className="pipe-file">Pipeline</span>
        <span className="pipe-name">{active?.name ?? 'Loading…'}</span>
        <span className="pipe-count">
          {active ? `${active.codeCount} codes` : ''}
        </span>
        <span className="pipe-caret">▾</span>
      </button>

      {open && (
        <div className="menu pipe-menu" role="menu">
          <div className="mh">
            <span className="rail-label">Pipelines · {pipelines.length}</span>
          </div>

          {pipelines.map((pipeline) => (
            <button
              key={pipeline.id}
              className="mi"
              role="menuitemradio"
              aria-checked={pipeline.id === activePipeline}
              onClick={() => {
                void selectPipeline(pipeline.id);
                setOpen(false);
              }}
            >
              <span className="tick">{pipeline.id === activePipeline ? '●' : ''}</span>
              <span style={{ minWidth: 0 }}>
                <span className="pipe-row-name">{pipeline.name}</span>
                <span className="pipe-row-meta">
                  {pipeline.codeCount} codes · {pipeline.edgeCount} edges
                </span>
              </span>
            </button>
          ))}

          <div className="div" />

          {draft ? (
            <div style={{ padding: '4px 8px 8px' }}>
              <div className="rail-label" style={{ marginBottom: 5 }}>
                {draft.mode === 'new' ? 'Name the new pipeline' : 'Rename pipeline'}
              </div>
              <input
                className="pipe-input"
                autoFocus
                value={draft.value}
                placeholder="Marketing attribution"
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitDraft();
                  if (e.key === 'Escape') setDraft(null);
                }}
              />
              <div className="btn-grid" style={{ marginTop: 6 }}>
                <button className="btn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button className="btn pri" onClick={submitDraft}>
                  {draft.mode === 'new' ? 'Create' : 'Rename'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button className="mi" role="menuitem" onClick={() => setDraft({ mode: 'new', value: '' })}>
                ＋ New empty pipeline
              </button>
              <button className="mi" role="menuitem" onClick={() => fileRef.current?.click()}>
                <span title="An .atlas.json file, or a dbt target/manifest.json — select catalog.json with it for column types">
                  ↑ Import from file…<span className="k">.atlas.json · dbt</span>
                </span>
              </button>
              <button
                className="mi"
                role="menuitem"
                onClick={() => {
                  exportPipeline();
                  setOpen(false);
                }}
              >
                ↓ Export this pipeline<span className="k">.atlas.json</span>
              </button>

              <div className="div" />
              <div className="mh" style={{ borderBottom: 0, marginBottom: 0 }}>
                <span className="rail-label">This pipeline</span>
              </div>

              <button
                className="mi indent"
                role="menuitem"
                title="Draw any link implied by a shared asset name"
                onClick={() => {
                  void relink();
                  setOpen(false);
                }}
              >
                Rebuild links from inputs &amp; outputs
              </button>
              <button className="mi indent" role="menuitem" onClick={() => setDraft({ mode: 'rename', value: active?.name ?? '' })}>
                Rename
              </button>
              <button
                className={`mi indent${confirmDelete ? ' danger' : ''}`}
                role="menuitem"
                disabled={pipelines.length <= 1}
                style={pipelines.length <= 1 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  void removePipeline(activePipeline);
                  setConfirmDelete(false);
                  setOpen(false);
                }}
              >
                {confirmDelete ? 'Really delete? Everything in it goes.' : 'Delete'}
              </button>
            </>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) void importPipelineFiles(files);
          e.target.value = '';
          setOpen(false);
        }}
      />
    </div>
  );
}
