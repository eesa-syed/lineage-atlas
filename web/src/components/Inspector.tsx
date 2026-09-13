import { useEffect, useMemo, useState } from 'react';
import { useAtlas } from '../state/store';
import { downstream, upstream } from '../lib/lineage';
import { AssetLinkList } from './AssetLinkEditor';
import {
  STATUS_COLOR, assetLinkTag, codeColor, formatStamp, fromLocalInput, primaryTag, tagColor, toLocalInput,
  type Code, type CodePatch, type CodeStatus,
} from '../types';

const STATUSES: CodeStatus[] = ['active', 'inactive'];

/** The metadata form's fields. Dates are held as `<input type="datetime-local">`
 * strings — local, minute-resolution — and converted on the way out. */
interface MetaDraft {
  name: string;
  owner: string;
  status: CodeStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

const draftOf = (code: Code): MetaDraft => ({
  name: code.name,
  owner: code.owner,
  status: code.status,
  createdAt: toLocalInput(code.createdAt),
  updatedAt: toLocalInput(code.updatedAt),
  updatedBy: code.updatedBy,
});

/**
 * Only what the user actually changed. This is what keeps the two halves of
 * stewardship from fighting: leave the dates alone and the server stamps
 * `updatedAt`/`updatedBy` itself, as it does for every other kind of edit;
 * change one and the explicit value is sent and wins.
 *
 * Dates are compared in their input form, not as instants, because
 * `toLocalInput` drops seconds — comparing the round-tripped value would
 * otherwise report a change on every save and quietly truncate the record.
 */
function changedFields(code: Code, draft: MetaDraft): CodePatch {
  const patch: CodePatch = {};
  if (draft.name.trim() !== code.name) patch.name = draft.name.trim();
  if (draft.owner !== code.owner) patch.owner = draft.owner;
  if (draft.status !== code.status) patch.status = draft.status;
  if (draft.updatedBy !== code.updatedBy) patch.updatedBy = draft.updatedBy;

  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (draft[field] === toLocalInput(code[field])) continue;
    const iso = fromLocalInput(draft[field]);
    // A cleared or half-typed date is left out rather than sent as a broken
    // one; the field simply keeps the value it had.
    if (iso) patch[field] = iso;
  }
  return patch;
}

export function Inspector() {
  const codes = useAtlas((s) => s.codes);
  const edges = useAtlas((s) => s.edges);
  const selectedId = useAtlas((s) => s.selectedId);
  const openSchemaTab = useAtlas((s) => s.openSchemaTab);
  const openFlowTab = useAtlas((s) => s.openFlowTab);
  const startConnect = useAtlas((s) => s.startConnect);
  const duplicate = useAtlas((s) => s.duplicate);
  const addTag = useAtlas((s) => s.addTag);
  const removeTag = useAtlas((s) => s.removeTag);
  const setPrimary = useAtlas((s) => s.setPrimaryTag);
  const saveDescription = useAtlas((s) => s.saveDescription);
  const saveMetadata = useAtlas((s) => s.saveMetadata);

  const code = useMemo(() => codes.find((n) => n.id === selectedId) ?? null, [codes, selectedId]);

  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [metaDraft, setMetaDraft] = useState<MetaDraft | null>(null);

  // Drafts belong to the code that was open — drop them when the selection moves.
  useEffect(() => {
    setTagDraft(null);
    setDescDraft(null);
    setMetaDraft(null);
  }, [selectedId]);

  if (!code) {
    return (
      <aside className="inspector">
        <div className="empty">
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
            <rect x="1.5" y="6" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="21" y="2" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="21" y="20" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M12.5 10h4c2 0 2-4 4-4M12.5 10h4c2 0 2 14 4 14" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <div>Select a code to read its documentation.</div>
          <div style={{ marginTop: 8, fontSize: 11 }}>Double-click opens the logic flow in a new tab.</div>
        </div>
      </aside>
    );
  }

  const sourcePath = code.inputs.find((a) => assetLinkTag(a) === 'file')?.path ?? code.outputs[0]?.path ?? '—';
  const up = upstream(code.id, edges).size;
  const down = downstream(code.id, edges).size;

  return (
    <aside className="inspector">
      <div className="insp-head">
        <div className="insp-title">
          <span className="badge" style={{ color: codeColor(code) }}>
            {primaryTag(code)}
          </span>
          <span className="nn">{code.name}</span>
        </div>
        <div className="path" title={code.name}>
          {sourcePath}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 9 }}>
          <span className="stat">
            <span className="d" style={{ background: STATUS_COLOR[code.status] }} />
            {code.status}
          </span>
        </div>
      </div>

      <div className="scroll">
        <div className="sec">
          <div className="sec-head">
            <span className="rail-label">Description</span>
            {descDraft === null ? (
              <button className="linkbtn" onClick={() => setDescDraft(code.description)}>
                edit
              </button>
            ) : (
              <span style={{ display: 'flex', gap: 5 }}>
                <button className="linkbtn" onClick={() => setDescDraft(null)}>
                  cancel
                </button>
                <button
                  className="linkbtn"
                  onClick={() => {
                    void saveDescription(code.id, descDraft);
                    setDescDraft(null);
                  }}
                >
                  save
                </button>
              </span>
            )}
          </div>
          {descDraft === null ? (
            <div className="desc-box desc">{code.description || 'No description yet.'}</div>
          ) : (
            <textarea
              className="desc-box"
              autoFocus
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setDescDraft(null);
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  void saveDescription(code.id, descDraft);
                  setDescDraft(null);
                }
              }}
            />
          )}
        </div>

        <div className="sec">
          <div className="sec-head">
            <span className="rail-label">Tags · {code.tags.length}</span>
            <button className="linkbtn" onClick={() => setTagDraft('')}>
              + add tag
            </button>
          </div>

          {/* The main tag names and colours the code, so it gets a control of its
              own rather than being implied by chip order. */}
          <div className="primary-pick">
            <label className="rail-label" htmlFor={`primary-${code.id}`}>
              Main tag
            </label>
            <select
              id={`primary-${code.id}`}
              className="pipe-input"
              value={code.tags[0] ?? ''}
              disabled={code.tags.length < 2}
              style={{ ['--tc' as string]: tagColor(primaryTag(code)) }}
              onChange={(e) => void setPrimary(code.id, e.target.value)}
            >
              {code.tags.length === 0 && <option value="">no tags yet</option>}
              {code.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <span className="primary-note">
              {code.tags.length < 2 ? 'Add a second tag to choose.' : 'Names and colours this code.'}
            </span>
          </div>

          <div className="chips">
            {code.tags.map((tag, i) => (
              <span className={`chip picked${i === 0 ? ' primary' : ''}`} key={tag} style={{ ['--tc' as string]: tagColor(tag) }}>
                <span className="dotmark" />
                {tag}
                {i === 0 && <span className="mainflag">main</span>}
                {i > 0 && (
                  <button
                    className="mkmain"
                    title={`Make ${tag} the main tag`}
                    onClick={() => void setPrimary(code.id, tag)}
                  >
                    make main
                  </button>
                )}
                <button className="rm" aria-label={`Remove ${tag}`} onClick={() => void removeTag(code.id, tag)}>
                  ×
                </button>
              </span>
            ))}
            {tagDraft !== null && (
              <input
                className="chip-input"
                autoFocus
                value={tagDraft}
                placeholder="new tag ↵"
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={() => setTagDraft(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTagDraft(null);
                  if (e.key === 'Enter' && tagDraft.trim()) {
                    void addTag(code.id, tagDraft);
                    setTagDraft(null);
                  }
                }}
              />
            )}
          </div>
        </div>

        <AssetLinkList codeId={code.id} direction="input" assets={code.inputs} onOpenSchema={openSchemaTab} />
        <AssetLinkList codeId={code.id} direction="output" assets={code.outputs} onOpenSchema={openSchemaTab} />

        <div className="sec">
          <div className="sec-head">
            <span className="rail-label">Metadata</span>
            {metaDraft === null ? (
              <button className="linkbtn" onClick={() => setMetaDraft(draftOf(code))}>
                edit
              </button>
            ) : (
              <span style={{ display: 'flex', gap: 5 }}>
                <button className="linkbtn" onClick={() => setMetaDraft(null)}>
                  cancel
                </button>
                <button
                  className="linkbtn"
                  onClick={() => {
                    const patch = changedFields(code, metaDraft);
                    if (Object.keys(patch).length) void saveMetadata(code.id, patch);
                    setMetaDraft(null);
                  }}
                >
                  save
                </button>
              </span>
            )}
          </div>
          {metaDraft === null ? (
            <dl className="kv">
              <dt>Owner</dt>
              <dd>{code.owner || '—'}</dd>
              <dt>Status</dt>
              <dd>{code.status}</dd>
              <dt>Upstream</dt>
              <dd>{up} codes</dd>
              <dt>Downstream</dt>
              <dd>{down} codes</dd>
              {/* Documented, not run: when this page was written and last
                  edited, and by whom. Owner is editable and these are not —
                  they are recorded by the act of editing. */}
              <dt>Created</dt>
              <dd title={code.createdAt}>{formatStamp(code.createdAt)}</dd>
              <dt>Updated</dt>
              <dd title={code.updatedAt}>{formatStamp(code.updatedAt)}</dd>
              <dt>Last edit by</dt>
              <dd>{code.updatedBy || '—'}</dd>
            </dl>
          ) : (
            <div style={{ display: 'grid', gap: 7 }}>
              <div>
                <label className="rail-label" htmlFor="meta-name">
                  Name
                </label>
                <input
                  id="meta-name"
                  className="pipe-input"
                  style={{ marginTop: 4 }}
                  value={metaDraft.name}
                  placeholder="stg_orders"
                  onChange={(e) => setMetaDraft({ ...metaDraft, name: e.target.value })}
                />
              </div>
              <div>
                <label className="rail-label" htmlFor="meta-owner">
                  Owner
                </label>
                <input
                  id="meta-owner"
                  className="pipe-input"
                  style={{ marginTop: 4 }}
                  value={metaDraft.owner}
                  placeholder="Analytics Eng"
                  onChange={(e) => setMetaDraft({ ...metaDraft, owner: e.target.value })}
                />
              </div>
              <div>
                <label className="rail-label" htmlFor="meta-status">
                  Status
                </label>
                <select
                  id="meta-status"
                  className="pipe-input"
                  style={{ marginTop: 4 }}
                  value={metaDraft.status}
                  onChange={(e) => setMetaDraft({ ...metaDraft, status: e.target.value as CodeStatus })}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              {/* Leave these three alone and saving stamps them as usual; change
                  one and what you typed is what is recorded. */}
              <div>
                <label className="rail-label" htmlFor="meta-created">
                  Created
                </label>
                <input
                  id="meta-created"
                  type="datetime-local"
                  className="pipe-input"
                  style={{ marginTop: 4 }}
                  value={metaDraft.createdAt}
                  onChange={(e) => setMetaDraft({ ...metaDraft, createdAt: e.target.value })}
                />
              </div>
              <div>
                <label className="rail-label" htmlFor="meta-updated">
                  Updated
                </label>
                <input
                  id="meta-updated"
                  type="datetime-local"
                  className="pipe-input"
                  style={{ marginTop: 4 }}
                  value={metaDraft.updatedAt}
                  onChange={(e) => setMetaDraft({ ...metaDraft, updatedAt: e.target.value })}
                />
              </div>
              <div>
                <label className="rail-label" htmlFor="meta-updatedby">
                  Last edit by
                </label>
                <input
                  id="meta-updatedby"
                  className="pipe-input"
                  style={{ marginTop: 4 }}
                  value={metaDraft.updatedBy}
                  placeholder="who last touched this"
                  onChange={(e) => setMetaDraft({ ...metaDraft, updatedBy: e.target.value })}
                />
              </div>
              <p className="meta-note">
                Left as they are, Updated and Last edit by are stamped on save.
              </p>
            </div>
          )}
        </div>

        <div className="sec">
          <div className="sec-head">
            <span className="rail-label">Actions</span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <button className="btn pri" onClick={() => openFlowTab(code.id)}>
              ◱ {code.hasFlow ? 'Open' : 'Write'} code logic flow
            </button>
            <div className="btn-grid">
              <button className="btn" onClick={() => startConnect(code.id)}>
                ⇢ Connect forward
              </button>
              <button className="btn" onClick={() => void duplicate(code.id, false)}>
                ⧉ Duplicate
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
