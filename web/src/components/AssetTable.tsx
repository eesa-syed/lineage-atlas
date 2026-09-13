import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { codeColor, type CodeRef, type SchemaTable } from '../types';
import type { Density } from '../lib/schemaGraph';

export interface TableNodeData extends Record<string, unknown> {
  table: SchemaTable;
  density: Density;
  dim: boolean;
  /** Ids of columns matching the search. */
  matched: ReadonlySet<string>;
  onOpenCode: (codeId: string) => void;
}

export type TableFlowNode = Node<TableNodeData, 'table'>;

/** How many reading codes fit on one line before the rest become a count. */
const SHOWN_CONSUMERS = 2;

function TableGlyph({ empty }: { empty: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" strokeDasharray={empty ? '2.4 2' : undefined} />
      <path d={empty ? 'M2 6.2h12' : 'M2 6.2h12M2 10h12M6.4 6.2v7.3'} />
    </svg>
  );
}

/** A code that writes or reads this table, coloured by its main tag and opening
 * on the Flow tab — the same chip the asset's schema page uses for lineage. */
function CodeChip({ code, onOpen }: { code: CodeRef; onOpen: (codeId: string) => void }) {
  return (
    <button
      className="tbl-code"
      title={`${code.name} — open on the Flow tab`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(code.id);
      }}
    >
      <span className="sw" style={{ background: codeColor(code) }} />
      {code.name}
    </button>
  );
}

/**
 * One asset drawn as a table: a header band, ruled column rows, the codes on
 * either side of it, and a footer of counts. Shaped differently from a code card
 * on purpose — no tag bar, no description — so the two kinds of node tell
 * themselves apart by structure and the canvas does not spend a colour on it.
 */
function AssetTableNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { table, density, dim, matched, onOpenCode } = data;
  const undocumented = table.columns.length === 0;
  const tested = table.columns.filter((c) => c.tests.length > 0).length;

  // Zoomed out, a table shrinks to what still matters at that distance — but a
  // column matching the search always stays, so the answer never zooms away.
  let rows = table.columns;
  if (density === 'keys') rows = table.columns.filter((c) => c.keyKind || matched.has(c.id));
  if (density === 'name') rows = table.columns.filter((c) => matched.has(c.id));
  const hidden = density === 'keys' ? table.columns.length - rows.length : 0;

  const consumers = table.consumedBy.slice(0, SHOWN_CONSUMERS);
  const moreConsumers = table.consumedBy.length - consumers.length;
  const showLineage = density !== 'name' && (table.producedBy !== null || table.consumedBy.length > 0);

  const className = ['tbl-node', undocumented ? 'undoc' : '', selected ? 'selected' : '', dim ? 'dim' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <div className="tbl-head" title={table.description || table.name}>
        <TableGlyph empty={undocumented} />
        <span className="tbl-name">{table.name}</span>
        <span className="tbl-mat">{table.materialization}</span>
      </div>

      {density !== 'name' && (table.certified || table.containsPii) && (
        <div className="tbl-badges">
          {table.certified && (
            <span className="badge" style={{ color: 'var(--good)' }}>
              certified
            </span>
          )}
          {table.containsPii && (
            <span className="badge" style={{ color: 'var(--bad)' }}>
              contains pii
            </span>
          )}
        </div>
      )}

      {undocumented && density !== 'name' && (
        <div className="tbl-empty">
          no schema yet
          <span>double-click to document it</span>
        </div>
      )}

      {(rows.length > 0 || hidden > 0) && (
        <div className="tbl-rows">
          {rows.map((column) => (
            <div
              key={column.id}
              className={`tbl-row${matched.has(column.id) ? ' matched' : ''}`}
              title={column.description || undefined}
            >
              <span>
                {column.keyKind === 'pk' && <span className="pk p">PK</span>}
                {column.keyKind === 'fk' && <span className="pk f">FK</span>}
              </span>
              <span className="tbl-col">{column.name}</span>
              <span className="tbl-type">{column.dataType}</span>
              <span
                className={`tbl-test ${column.tests.length ? 'ok' : 'no'}`}
                title={column.tests.length ? column.tests.join(', ') : 'untested'}
              />
            </div>
          ))}
          {hidden > 0 && (
            <div className="tbl-row more">
              <span />
              <span className="tbl-col">
                +{hidden} more column{hidden === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Which codes sit either side of this table: the one that writes it, and the
          ones that read it. Both are already on the asset, from its links. */}
      {showLineage && (
        <div className="tbl-lineage">
          <div className="tbl-lin">
            <span className="lbl">produced by</span>
            {table.producedBy ? (
              <CodeChip code={table.producedBy} onOpen={onOpenCode} />
            ) : (
              <span className="none">nothing writes this</span>
            )}
          </div>
          <div className="tbl-lin">
            <span className="lbl">consumed by</span>
            {table.consumedBy.length > 0 ? (
              <span className="tbl-codes">
                {consumers.map((code) => (
                  <CodeChip key={code.id} code={code} onOpen={onOpenCode} />
                ))}
                {moreConsumers > 0 && (
                  <span className="more" title={table.consumedBy.map((c) => c.name).join(', ')}>
                    +{moreConsumers}
                  </span>
                )}
              </span>
            ) : (
              <span className="none">nothing reads this</span>
            )}
          </div>
        </div>
      )}

      <div className="tbl-foot">
        <span>{table.columns.length} cols</span>
        {!undocumented && (
          <>
            <span>·</span>
            <span className={tested * 2 < table.columns.length ? 'warn' : undefined}>{tested} tested</span>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(AssetTableNode);
