import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAtlas } from '../state/store';
import { SchemaEditor } from './SchemaEditor';
import { codeColor, formatStamp, type Asset, type AssetSchemaInput } from '../types';

export function SchemaPane({ assetId }: { assetId: string }) {
  const select = useAtlas((s) => s.select);
  const setActiveTab = useAtlas((s) => s.setActiveTab);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const notify = useAtlas((s) => s.notify);
  const assetRenamed = useAtlas((s) => s.assetRenamed);

  useEffect(() => {
    let cancelled = false;
    api
      .asset(assetId)
      .then((result) => !cancelled && setAsset(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const goToCode = (id: string) => {
    setActiveTab('graph');
    select(id, true);
  };

  if (error) return <div className="doc"><div className="doc-inner"><div className="empty">{error}</div></div></div>;
  if (!asset) return <div className="doc"><div className="empty">Loading schema…</div></div>;

  const nullableCount = asset.columns.filter((c) => c.nullable).length;
  const testedCount = asset.columns.filter((c) => c.tests.length > 0).length;

  return (
    <div className="doc">
      <div className="doc-inner">
        <div className="doc-head">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="badge" style={{ color: 'var(--t-sql)' }}>
                asset
              </span>
              <span className="rail-label">{asset.materialization}</span>
              {asset.certified && (
                <span className="badge" style={{ color: 'var(--good)' }}>
                  certified
                </span>
              )}
              {asset.containsPii && (
                <span className="badge" style={{ color: 'var(--bad)' }}>
                  contains pii
                </span>
              )}
            </div>
            <h1>{asset.name}</h1>
            <p>{asset.description || 'No description yet.'}</p>
            {/* Who is answerable for the table, and the life of the page that
                documents it. Not freshness: nothing here has looked at the
                warehouse. Owner is edited with the schema; the rest is
                recorded by the act of editing. */}
            <p className="steward">
              <span>
                Owner <b>{asset.owner || 'unassigned'}</b>
              </span>
              <span>
                Documented <time dateTime={asset.createdAt}>{formatStamp(asset.createdAt)}</time>
              </span>
              <span>
                Updated <time dateTime={asset.updatedAt}>{formatStamp(asset.updatedAt)}</time>
                {asset.updatedBy && <> by <b>{asset.updatedBy}</b></>}
              </span>
            </p>
          </div>
          {!editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              ✎ {asset.columns.length ? 'Edit schema' : 'Add schema'}
            </button>
          )}
        </div>

        <div className="metrics">
          <div>
            <div className="lb">Columns</div>
            <div className="vl">{asset.columns.length}</div>
          </div>
          <div>
            <div className="lb">Nullable</div>
            <div className="vl">{nullableCount}</div>
          </div>
          <div>
            <div className="lb">Tested</div>
            <div className="vl">{testedCount}</div>
          </div>
          <div>
            <div className="lb">Consumers</div>
            <div className="vl">{asset.consumedBy.length}</div>
          </div>
        </div>

        {editing ? (
          <SchemaEditor
            asset={asset}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={async (input: AssetSchemaInput) => {
              setSaving(true);
              try {
                const saved = await api.saveSchema(assetId, input);
                setAsset(saved);
                setEditing(false);
                // A rename rewrites the paths on every input and output that
                // named this table, so the graph the rail is holding is stale.
                if (saved.name !== asset.name) await assetRenamed(assetId, saved.name);
                notify(saved.name !== asset.name ? `Renamed to ${saved.name}` : 'Schema saved');
              } catch (err) {
                notify(err instanceof Error ? err.message : 'Could not save the schema.', 'error');
              } finally {
                setSaving(false);
              }
            }}
          />
        ) : (
          <>
        <div className="doc-h2">
          <span className="rail-label">Columns</span>
          <span className="ln" />
          <span className="rail-label">{asset.columns.length} fields</span>
        </div>

        {asset.columns.length === 0 ? (
          <div className="card">
            <div className="empty">
              No columns documented for this asset yet.
              <button className="btn pri" style={{ margin: '10px auto 0', width: 'fit-content' }} onClick={() => setEditing(true)}>
                ✎ Add schema
              </button>
            </div>
          </div>
        ) : (
          <div className="card tbl-wrap">
            <table className="sch">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Key</th>
                  <th>Description</th>
                  <th>Tests</th>
                </tr>
              </thead>
              <tbody>
                {asset.columns.map((column) => (
                  <tr key={column.id}>
                    <td className="cn">{column.name}</td>
                    <td className="ct">{column.dataType}</td>
                    <td>
                      {column.keyKind === 'pk' && <span className="pk p">PK</span>}
                      {column.keyKind === 'fk' && <span className="pk f">FK</span>}
                      {!column.keyKind && column.nullable && <span className="pk n">null</span>}
                    </td>
                    <td className="cd">{column.description}</td>
                    <td>
                      <div className="tests">
                        {column.tests.length ? (
                          column.tests.map((test) => (
                            <span className="tst ok" key={test}>
                              {test}
                            </span>
                          ))
                        ) : (
                          <span className="tst warn">untested</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

          </>
        )}

        <div className="doc-h2">
          <span className="rail-label">Lineage</span>
          <span className="ln" />
        </div>
        <div className="split">
          <div className="card" style={{ padding: '12px 13px' }}>
            <div className="rail-label" style={{ marginBottom: 8 }}>
              Produced by
            </div>
            {asset.producedBy ? (
              <button className="lin-chip" onClick={() => goToCode(asset.producedBy!.id)}>
                <span className="sw" style={{ background: codeColor(asset.producedBy) }} />
                {asset.producedBy.name}
              </button>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>—</span>
            )}
          </div>
          <div className="card" style={{ padding: '12px 13px' }}>
            <div className="rail-label" style={{ marginBottom: 8 }}>
              Consumed by · {asset.consumedBy.length}
            </div>
            <div className="lin-chips">
              {asset.consumedBy.map((consumer) => (
                <button className="lin-chip" key={consumer.id} onClick={() => goToCode(consumer.id)}>
                  <span className="sw" style={{ background: codeColor(consumer) }} />
                  {consumer.name}
                </button>
              ))}
              {asset.consumedBy.length === 0 && <span style={{ color: 'var(--ink-3)' }}>Nothing reads this yet.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
