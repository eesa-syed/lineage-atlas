import { useState } from 'react';
import { fromLocalInput, toLocalInput, type Asset, type AssetSchemaInput } from '../types';

type ColumnDraft = AssetSchemaInput['columns'][number];

const BLANK: ColumnDraft = { name: '', dataType: 'varchar', keyKind: null, nullable: false, description: '', tests: [] };

/** Edits an asset's documented schema: description, columns and sample rows. */
export function SchemaEditor({
  asset,
  saving,
  onSave,
  onCancel,
}: {
  asset: Asset;
  saving: boolean;
  onSave: (input: AssetSchemaInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [materialization, setMaterialization] = useState(asset.materialization);
  const [description, setDescription] = useState(asset.description);
  const [owner, setOwner] = useState(asset.owner);
  const [createdAt, setCreatedAt] = useState(toLocalInput(asset.createdAt));
  const [updatedAt, setUpdatedAt] = useState(toLocalInput(asset.updatedAt));
  const [updatedBy, setUpdatedBy] = useState(asset.updatedBy);

  /**
   * Dates and the editor's name go out only when they actually changed: an
   * untouched form saves the schema and lets the server stamp `updatedAt` /
   * `updatedBy` as it does for any other edit, while a deliberate change is
   * sent and wins. Compared in input form, since `toLocalInput` drops seconds
   * and a round-trip would otherwise look like an edit every time.
   */
  const stewardship = (): Pick<AssetSchemaInput, 'name' | 'createdAt' | 'updatedAt' | 'updatedBy'> => {
    const patch: Pick<AssetSchemaInput, 'name' | 'createdAt' | 'updatedAt' | 'updatedBy'> = {};
    if (name.trim() !== asset.name) patch.name = name.trim();
    if (updatedBy !== asset.updatedBy) patch.updatedBy = updatedBy;
    if (createdAt !== toLocalInput(asset.createdAt)) {
      const iso = fromLocalInput(createdAt);
      if (iso) patch.createdAt = iso;
    }
    if (updatedAt !== toLocalInput(asset.updatedAt)) {
      const iso = fromLocalInput(updatedAt);
      if (iso) patch.updatedAt = iso;
    }
    return patch;
  };
  const [columns, setColumns] = useState<ColumnDraft[]>(
    asset.columns.map((c) => ({
      name: c.name,
      dataType: c.dataType,
      keyKind: c.keyKind,
      nullable: c.nullable,
      description: c.description,
      tests: c.tests,
    })),
  );

  const patch = (i: number, next: Partial<ColumnDraft>) =>
    setColumns(columns.map((c, index) => (index === i ? { ...c, ...next } : c)));

  const move = (i: number, by: number) => {
    const target = i + by;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[i], next[target]] = [next[target], next[i]];
    setColumns(next);
  };

  return (
    <>
      <div className="card" style={{ padding: '13px 15px', display: 'grid', gap: 9 }}>
        <div>
          <label className="rail-label" htmlFor="dsname">
            Name
          </label>
          <input
            id="dsname"
            className="pipe-input"
            style={{ marginTop: 4 }}
            value={name}
            placeholder="analytics.my_table"
            onChange={(e) => setName(e.target.value)}
          />
          <p className="meta-note">Renaming carries every input and output that names it.</p>
        </div>
        <div>
          <label className="rail-label" htmlFor="mat">
            Materialization
          </label>
          <input
            id="mat"
            className="pipe-input"
            style={{ marginTop: 4 }}
            value={materialization}
            placeholder="table / view / incremental table"
            onChange={(e) => setMaterialization(e.target.value)}
          />
        </div>
        <div>
          <label className="rail-label" htmlFor="dsowner">
            Owner
          </label>
          <input
            id="dsowner"
            className="pipe-input"
            style={{ marginTop: 4 }}
            value={owner}
            placeholder="Analytics Eng"
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div>
          <label className="rail-label" htmlFor="dsdesc">
            What this asset is
          </label>
          <textarea
            id="dsdesc"
            className="pipe-input"
            style={{ marginTop: 4 }}
            rows={2}
            value={description}
            placeholder="One row per order, money normalised to USD."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="meta-grid">
          <div>
            <label className="rail-label" htmlFor="dscreated">
              Created
            </label>
            <input
              id="dscreated"
              type="datetime-local"
              className="pipe-input"
              style={{ marginTop: 4 }}
              value={createdAt}
              onChange={(e) => setCreatedAt(e.target.value)}
            />
          </div>
          <div>
            <label className="rail-label" htmlFor="dsupdated">
              Updated
            </label>
            <input
              id="dsupdated"
              type="datetime-local"
              className="pipe-input"
              style={{ marginTop: 4 }}
              value={updatedAt}
              onChange={(e) => setUpdatedAt(e.target.value)}
            />
          </div>
          <div>
            <label className="rail-label" htmlFor="dsupdatedby">
              Last edit by
            </label>
            <input
              id="dsupdatedby"
              className="pipe-input"
              style={{ marginTop: 4 }}
              value={updatedBy}
              placeholder="who last touched this"
              onChange={(e) => setUpdatedBy(e.target.value)}
            />
          </div>
        </div>
        <p className="meta-note">Left as they are, Updated and Last edit by are stamped on save.</p>
      </div>

      <div className="doc-h2">
        <span className="rail-label">Columns · {columns.length}</span>
        <span className="ln" />
        <button className="linkbtn" onClick={() => setColumns([...columns, { ...BLANK }])}>
          + add column
        </button>
      </div>

      <div className="card tbl-wrap">
        <table className="sch sch-edit">
          <thead>
            <tr>
              <th style={{ width: 34 }} />
              <th>Column</th>
              <th>Type</th>
              <th style={{ width: 96 }}>Key</th>
              <th>Description</th>
              <th style={{ width: 150 }}>Tests</th>
              <th style={{ width: 92 }} />
            </tr>
          </thead>
          <tbody>
            {columns.map((column, i) => (
              <tr key={i}>
                <td className="mono" style={{ color: 'var(--ink-3)' }}>
                  {i + 1}
                </td>
                <td>
                  <input
                    className="pipe-input"
                    value={column.name}
                    placeholder="order_id"
                    aria-label={`Column ${i + 1} name`}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="pipe-input"
                    value={column.dataType}
                    placeholder="varchar"
                    aria-label={`Column ${i + 1} type`}
                    onChange={(e) => patch(i, { dataType: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="pipe-input"
                    value={column.keyKind ?? (column.nullable ? 'null' : '')}
                    aria-label={`Column ${i + 1} key`}
                    onChange={(e) => {
                      const v = e.target.value;
                      patch(i, {
                        keyKind: v === 'pk' || v === 'fk' ? v : null,
                        nullable: v === 'null',
                      });
                    }}
                  >
                    <option value="">—</option>
                    <option value="pk">PK</option>
                    <option value="fk">FK</option>
                    <option value="null">nullable</option>
                  </select>
                </td>
                <td>
                  <input
                    className="pipe-input"
                    value={column.description}
                    placeholder="What it means, and any gotcha."
                    aria-label={`Column ${i + 1} description`}
                    onChange={(e) => patch(i, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="pipe-input"
                    value={column.tests.join(', ')}
                    placeholder="not_null, unique"
                    aria-label={`Column ${i + 1} tests`}
                    onChange={(e) => patch(i, { tests: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button className="linkbtn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                      ↑
                    </button>
                    <button className="linkbtn" disabled={i === columns.length - 1} onClick={() => move(i, 1)} title="Move down">
                      ↓
                    </button>
                    <button className="linkbtn danger" onClick={() => setColumns(columns.filter((_, index) => index !== i))}>
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {columns.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '20px 0' }}>
                  No columns yet. <b>+ add column</b> to document the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn pri"
          disabled={saving}
          onClick={() =>
            // Sample rows are preserved as-is; they are edited elsewhere or come from an import.
            onSave({ materialization, description, owner, columns, ...stewardship() })
          }
        >
          {saving ? 'Saving…' : 'Save schema'}
        </button>
      </div>
    </>
  );
}
