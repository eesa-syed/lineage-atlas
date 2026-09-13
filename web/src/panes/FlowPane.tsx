import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAtlas } from '../state/store';
import { FlowEditor } from './FlowEditor';
import { STATUS_COLOR, assetLinkTag, codeColor, primaryTag, tagColor, type AssetLink, type CodeFlow, type FlowInput } from '../types';

/**
 * One input/output row. Links that resolve to a catalogued asset open its
 * schema tab for navigation; undocumented links (a bare path with nothing
 * catalogued yet) stay plain text since there's nowhere to send them.
 */
function IoRow({ link, onOpen }: { link: AssetLink; onOpen: (assetId: string) => void }) {
  const tag = assetLinkTag(link);
  const inner = (
    <>
      {tag && (
        <span className="gl" style={{ color: tagColor(tag) }}>
          {tag}
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span className={link.assetId ? 'p linked' : 'p'}>{link.path}</span>
        <span className="s">{link.detail}</span>
      </span>
      {link.assetId ? <span className="go">↗</span> : <span />}
    </>
  );
  return link.assetId ? (
    <button className="io-row ds" title="Open this asset's schema" onClick={() => onOpen(link.assetId!)}>
      {inner}
    </button>
  ) : (
    <div className="io-row">{inner}</div>
  );
}

export function FlowPane({ codeId }: { codeId: string }) {
  const code = useAtlas((s) => s.codes.find((n) => n.id === codeId));
  const [flow, setFlow] = useState<CodeFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const notify = useAtlas((s) => s.notify);
  const reload = useAtlas((s) => s.load);
  const openSchemaTab = useAtlas((s) => s.openSchemaTab);

  useEffect(() => {
    let cancelled = false;
    api
      .flow(codeId)
      .then((result) => !cancelled && setFlow(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [codeId]);

  if (error) return <div className="doc"><div className="doc-inner"><div className="empty">{error}</div></div></div>;
  if (!code || !flow) return <div className="doc"><div className="empty">Loading logic flow…</div></div>;

  return (
    <div className="doc">
      <div className="doc-inner">
        <div className="doc-head">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="badge" style={{ color: codeColor(code) }}>
                {primaryTag(code)}
              </span>
              <span className="rail-label">code logic flow</span>
            </div>
            <h1>{code.name}</h1>
            <p>{code.description}</p>
          </div>
          {!editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              ✎ Edit logic flow
            </button>
          )}
        </div>

        <div className="metrics">
          <div>
            <div className="lb">Steps</div>
            <div className="vl">{flow.steps.length}</div>
          </div>
          <div>
            <div className="lb">Inputs</div>
            <div className="vl">{code.inputs.length}</div>
          </div>
          <div>
            <div className="lb">Outputs</div>
            <div className="vl">{code.outputs.length}</div>
          </div>
          <div>
            <div className="lb">Status</div>
            <div className="vl" style={{ color: STATUS_COLOR[code.status] }}>
              {code.status}
            </div>
          </div>
        </div>

        <div className="doc-h2">
          <span className="rail-label">Logic, step by step</span>
          <span className="ln" />
          {editing && <span className="rail-label">editing</span>}
        </div>

        {editing ? (
          <FlowEditor
            flow={flow}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={async (input: FlowInput) => {
              setSaving(true);
              try {
                const saved = await api.saveFlow(codeId, input);
                setFlow(saved);
                setEditing(false);
                // hasFlow lives on the graph payload.
                await reload();
                notify('Logic flow saved');
              } catch (err) {
                notify(err instanceof Error ? err.message : 'Could not save the logic flow.', 'error');
              } finally {
                setSaving(false);
              }
            }}
          />
        ) : flow.steps.length === 0 ? (
          <div className="card">
            <div className="empty">
              No logic documented for this code yet.
              <br />
              <button className="btn pri" style={{ margin: '10px auto 0', width: 'fit-content' }} onClick={() => setEditing(true)}>
                ✎ Write the logic flow
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <div>
              {flow.steps.map((s, i) => (
                <div className="step" key={s.id}>
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <h4>
                      {s.title}
                      <span className="op">{s.op}</span>
                    </h4>
                    <p>{s.body}</p>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="doc-h2">
          <span className="rail-label">Reads &amp; writes</span>
          <span className="ln" />
        </div>
        <div className="split">
          <div className="card" style={{ padding: '11px 13px' }}>
            <div className="rail-label" style={{ marginBottom: 7 }}>
              Inputs
            </div>
            {code.inputs.map((a) => (
              <IoRow key={a.id} link={a} onOpen={openSchemaTab} />
            ))}
          </div>
          <div className="card" style={{ padding: '11px 13px' }}>
            <div className="rail-label" style={{ marginBottom: 7 }}>
              Outputs
            </div>
            {code.outputs.map((a) => (
              <IoRow key={a.id} link={a} onOpen={openSchemaTab} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
