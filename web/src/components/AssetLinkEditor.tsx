import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAtlas } from '../state/store';
import { assetLinkTag, normaliseTag, tagColor, type AssetLink, type AssetLinkInput, type AssetSummary } from '../types';

interface Draft {
  path: string;
  detail: string;
  tags: string[];
  documented: boolean;
}

const EMPTY: Draft = { path: '', detail: '', tags: [], documented: true };

/** Add / edit / remove one code's inputs or outputs. */
export function AssetLinkList({
  codeId,
  direction,
  assets,
  onOpenSchema,
}: {
  codeId: string;
  direction: 'input' | 'output';
  assets: AssetLink[];
  onOpenSchema: (assetId: string) => void;
}) {
  const addAssetLink = useAtlas((s) => s.addAssetLink);
  const updateAssetLink = useAtlas((s) => s.updateAssetLink);
  const deleteAssetLink = useAtlas((s) => s.deleteAssetLink);

  const activePipeline = useAtlas((s) => s.activePipeline);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [tagDraft, setTagDraft] = useState('');
  const [known, setKnown] = useState<AssetSummary[]>([]);

  // The pipeline's existing assets, so a documented asset can be picked rather
  // than retyped — a typo would otherwise quietly create a second one.
  const open = adding || editingId !== null;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .assets(activePipeline)
      .then((list) => !cancelled && setKnown(list))
      .catch(() => !cancelled && setKnown([]));
    return () => {
      cancelled = true;
    };
  }, [open, activePipeline]);

  useEffect(() => {
    setEditingId(null);
    setAdding(false);
  }, [codeId]);

  const startEdit = (asset: AssetLink) => {
    setAdding(false);
    setEditingId(asset.id);
    setDraft({ path: asset.path, detail: asset.detail, tags: asset.tags, documented: !!asset.assetId });
  };

  const close = () => {
    setEditingId(null);
    setAdding(false);
    setDraft(EMPTY);
    setTagDraft('');
  };

  const save = () => {
    if (!draft.path.trim()) return;
    const payload: AssetLinkInput = {
      direction,
      path: draft.path.trim(),
      detail: draft.detail.trim(),
      tags: draft.tags,
      documented: draft.documented,
    };
    if (editingId) void updateAssetLink(codeId, editingId, payload);
    else void addAssetLink(codeId, payload);
    close();
  };

  const addTagToDraft = () => {
    const tag = normaliseTag(tagDraft);
    if (tag && !draft.tags.includes(tag)) setDraft({ ...draft, tags: [...draft.tags, tag] });
    setTagDraft('');
  };
  const removeTagFromDraft = (tag: string) => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) });

  const typed = draft.path.trim().toLowerCase();
  const exactMatch = known.find((d) => d.name.toLowerCase() === typed) ?? null;
  const suggestions = useMemo(() => {
    if (!draft.documented) return [];
    const matches = typed ? known.filter((d) => d.name.toLowerCase().includes(typed)) : known;
    return matches.filter((d) => d.name.toLowerCase() !== typed).slice(0, 6);
  }, [known, typed, draft.documented]);

  const form = (
    <div className="art-form">
      <input
        className="pipe-input"
        autoFocus
        value={draft.path}
        placeholder={draft.documented ? 'analytics.my_table' : 'models/staging/my_model.sql'}
        aria-label="Path"
        onChange={(e) => setDraft({ ...draft, path: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') close();
        }}
      />

      <input
        className="pipe-input"
        style={{ marginTop: 5 }}
        value={draft.detail}
        placeholder="132 lines · 8.4 M rows · daily"
        aria-label="Detail"
        onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') close();
        }}
      />

      <div className="rail-label" style={{ margin: '7px 0 4px' }}>
        Tags {draft.tags.length > 0 && <span style={{ color: 'var(--accent)' }}>· {draft.tags[0]} is the main tag</span>}
      </div>
      <div className="chips" style={{ marginBottom: 5 }}>
        {draft.tags.map((tag, i) => (
          <span className="chip picked" key={tag} style={{ ['--tc' as string]: tagColor(tag) }}>
            {i === 0 && <span className="dotmark" />}
            {tag}
            <button className="rm" aria-label={`Remove ${tag}`} onClick={() => removeTagFromDraft(tag)}>
              ×
            </button>
          </span>
        ))}
        <input
          className="chip-input"
          value={tagDraft}
          placeholder="new tag ↵"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTagToDraft();
            }
            if (e.key === 'Escape') close();
          }}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-2)', margin: '6px 0 2px' }}>
        <input
          type="checkbox"
          checked={draft.documented}
          onChange={(e) => setDraft({ ...draft, documented: e.target.checked })}
        />
        Documented asset — links to (or creates) a schema page
      </label>

      {draft.documented && (
        <>
          {typed !== '' && (
            <p className={`resolve ${exactMatch ? 'known' : 'fresh'}`}>
              {exactMatch ? (
                <>
                  Links to an existing asset —{' '}
                  {exactMatch.columnCount > 0 ? `${exactMatch.columnCount} columns documented` : 'no schema yet'}
                  {exactMatch.producedBy && direction === 'output' && exactMatch.producedBy.id !== codeId && (
                    <> · already produced by <b>{exactMatch.producedBy.name}</b></>
                  )}
                </>
              ) : (
                <>Not in the catalogue yet — this will create it.</>
              )}
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="ds-suggest">
              <div className="rail-label" style={{ marginBottom: 3 }}>
                {typed ? 'Matching assets' : 'Assets in this pipeline'}
              </div>
              {suggestions.map((asset) => (
                <button key={asset.id} className="ds-suggest-row" onClick={() => setDraft({ ...draft, path: asset.name })}>
                  <span className="dsname">{asset.name}</span>
                  <span className="dsmeta">
                    {asset.columnCount > 0 ? `${asset.columnCount} cols` : 'no schema'}
                    {asset.producedBy ? ` · from ${asset.producedBy.name}` : ' · no producer'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <p className="form-note">
            {direction === 'output'
              ? 'Declaring an output makes this code the asset’s producer, and links it to every code that lists the same name as an input.'
              : 'Whoever outputs this asset is linked to this code automatically.'}
          </p>
        </>
      )}

      <div className="btn-grid" style={{ marginTop: 7 }}>
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn pri" onClick={save} disabled={!draft.path.trim()}>
          {editingId ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="sec">
      <div className="sec-head">
        <span className="rail-label">
          {direction === 'input' ? 'Inputs' : 'Outputs'} · {assets.length}
        </span>
        <button
          className="linkbtn"
          onClick={() => {
            setEditingId(null);
            setAdding(!adding);
            setDraft(EMPTY);
          }}
        >
          {adding ? 'close' : '+ add'}
        </button>
      </div>

      {assets.map((asset) =>
        editingId === asset.id ? (
          <div key={asset.id}>{form}</div>
        ) : (
          <div className="io-row editable" key={asset.id}>
            {(() => {
              const tag = assetLinkTag(asset);
              return tag ? (
                <span className="gl" style={{ color: tagColor(tag) }}>
                  {tag}
                </span>
              ) : null;
            })()}
            <button
              className="io-main"
              disabled={!asset.assetId}
              onClick={() => asset.assetId && onOpenSchema(asset.assetId)}
              title={asset.assetId ? 'Open schema' : asset.path}
            >
              <span className={`p${asset.assetId ? ' linked' : ''}`}>{asset.path}</span>
              <span className="s">{asset.detail || assetLinkTag(asset) || 'asset'}</span>
            </button>
            <span className="io-actions">
              <button className="linkbtn" onClick={() => startEdit(asset)} title="Edit">
                edit
              </button>
              <button
                className="linkbtn danger"
                onClick={() => void deleteAssetLink(codeId, asset.id)}
                title="Remove"
              >
                ×
              </button>
            </span>
          </div>
        ),
      )}

      {adding && form}
      {assets.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: '4px 0' }}>
          None yet — <b>+ add</b> to record one.
        </div>
      )}
    </div>
  );
}
