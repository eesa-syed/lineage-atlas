import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import AssetTableNode, { type TableFlowNode } from './AssetTable';
import { api } from '../api/client';
import { useAtlas } from '../state/store';
import { TABLE_WIDTH, layoutGrid, searchTables, tableHeight, type Density } from '../lib/schemaGraph';
import type { SchemaTable } from '../types';

const nodeTypes = { table: AssetTableNode };
const NONE: ReadonlySet<string> = new Set();

/** The canvas carries asset cards and nothing else — no headings drawn onto it. */
type SchemaNode = TableFlowNode;
type DensityChoice = 'auto' | Density;
const DENSITY_LABEL: Record<DensityChoice, string> = { auto: 'Auto', all: 'All', keys: 'Keys', name: 'Names' };
const DENSITY_KEY = 'atlas-schema-density';
/** Dragged positions, per pipeline and per browser — a viewing preference, like
 * the rail's grouping, not part of the pipeline's shared record. */
const positionsKey = (graphId: string) => `atlas-schema-positions:${graphId}`;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser refusing storage still gets the setting for this session.
  }
}

/** Fit margins in px. The top clears the toolbar, which floats over the canvas's
 * first ~58px — a fractional padding would tuck the first row of cards under it. */
const FIT_PADDING = { top: '72px', right: '32px', bottom: '32px', left: '32px' } as const;
const MATCH_PADDING = { top: '96px', right: '64px', bottom: '64px', left: '64px' } as const;

/** Every column when close enough to read them, keys when pulled back, names at a distance. */
function densityAt(zoom: number): Density {
  return zoom >= 0.75 ? 'all' : zoom >= 0.45 ? 'keys' : 'name';
}

/**
 * The Schema tab: every documented asset in the pipeline drawn as a table with
 * its columns, grouped by schema. Tables are shown as they are — no links, no
 * mapping between them — and the search is how you move around: it dims what
 * does not match, frames what does, and Enter walks the matches one by one.
 *
 * Tables can be picked several at a time (Shift+click or ⌘/Ctrl+click, or Shift+drag a box) to
 * point at a group while presenting. Tables carry no tags, so there is nothing
 * to apply to them in bulk: the selection is a highlight, and dragging any one
 * picked table moves the whole group.
 */
export function SchemaCanvas({ active }: { active: boolean }) {
  const activePipeline = useAtlas((s) => s.activePipeline);
  const codes = useAtlas((s) => s.codes);
  const openSchemaTab = useAtlas((s) => s.openSchemaTab);
  const select = useAtlas((s) => s.select);
  const setActiveTab = useAtlas((s) => s.setActiveTab);

  const [tables, setTables] = useState<SchemaTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Picked tables: one after a plain click or an Enter jump, several after Shift+click or a box. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE);
  const [query, setQuery] = useState('');
  /** Position in the match list Enter last jumped to; null until the first jump. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [choice, setChoice] = useState<DensityChoice>(() => {
    const stored = readStored<string>(DENSITY_KEY, 'auto');
    return stored === 'all' || stored === 'keys' || stored === 'name' ? stored : 'auto';
  });
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>(() =>
    readStored(positionsKey(activePipeline), {}),
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<SchemaNode>([]);
  const { fitView, setCenter, getZoom, getNodes } = useReactFlow<SchemaNode>();
  const zoom = useStore((s) => s.transform[2]);
  // React Flow's own viewport measurement: zero until this pane is really on
  // screen, and fitting against zero sends the transform through NaN.
  const flowWidth = useStore((s) => s.width);
  const flowHeight = useStore((s) => s.height);
  const autoDensity = useStore((s) => densityAt(s.transform[2]));
  const density = choice === 'auto' ? autoDensity : choice;
  const layoutDensity: Density = choice === 'auto' ? 'all' : choice;
  /** Draw the backdrop and minimap only once this canvas is both on screen and
   * measured: either half missing makes them compute their geometry from zero. */
  const chrome = active && flowWidth > 0 && flowHeight > 0;
  const didFit = useRef(false);

  // A different pipeline is a different set of tables: start clean, with that
  // pipeline's own remembered layout.
  const shownPipeline = useRef(activePipeline);
  useEffect(() => {
    if (shownPipeline.current === activePipeline) return;
    shownPipeline.current = activePipeline;
    setTables(null);
    setPicked(NONE);
    setQuery('');
    setMoved(readStored(positionsKey(activePipeline), {}));
    didFit.current = false;
  }, [activePipeline]);

  // Refetch whenever the tab comes into view or the pipeline's codes change:
  // schemas are edited in their own document tabs, and marking an input or
  // output as a documented asset in the Flow tab can add a table.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api
      .schema(activePipeline)
      .then((result) => {
        if (cancelled) return;
        setTables(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the schema.');
      });
    return () => {
      cancelled = true;
    };
  }, [active, activePipeline, codes]);

  // Laid out for the tallest the tables can get at the chosen density, so a zoom
  // that changes how many columns show never reshuffles the tables themselves.
  const layout = useMemo(() => layoutGrid(tables ?? [], layoutDensity), [tables, layoutDensity]);
  const matches = useMemo(() => searchTables(tables ?? [], query), [tables, query]);
  // Name order is also schema-then-table order, so Enter walks the canvas the way it reads.
  const matchOrder = useMemo(
    () => (tables ?? []).filter((t) => matches?.has(t.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [tables, matches],
  );
  const matchedColumns = useMemo(
    () => (matches ? [...matches.values()].reduce((sum, columns) => sum + columns.size, 0) : 0),
    [matches],
  );

  /** A code named on a table opens where codes live: the Flow tab, centred on it —
   * the same jump the asset's schema page makes from its lineage chips. */
  const openCode = useCallback(
    (codeId: string) => {
      setActiveTab('graph');
      select(codeId, true);
    },
    [setActiveTab, select],
  );

  useEffect(() => {
    const tableNodes = (tables ?? []).map<TableFlowNode>((table) => ({
      id: table.id,
      type: 'table',
      position: moved[table.id] ?? layout.positions[table.id] ?? { x: 0, y: 0 },
      selected: picked.has(table.id),
      data: {
        table,
        density,
        dim: matches ? !matches.has(table.id) : false,
        matched: matches?.get(table.id) ?? NONE,
        onOpenCode: openCode,
      },
    }));
    setRfNodes(tableNodes);
  }, [tables, moved, layout, picked, density, matches, openCode, setRfNodes]);

  // The pane is display:none until its tab opens, so its nodes are only measured
  // once it shows — give them a moment before framing them.
  useEffect(() => {
    if (!active || didFit.current || rfNodes.length === 0 || !flowWidth || !flowHeight) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: FIT_PADDING, maxZoom: 1 });
      didFit.current = true;
    }, 60);
    return () => window.clearTimeout(timer);
  }, [active, rfNodes.length, flowWidth, flowHeight, fitView]);

  // Typing frames the matches — after a pause, so the view does not lurch on
  // every keystroke. A new query also restarts Enter from the first match.
  useEffect(() => {
    setCursor(null);
    if (!active || !matches || matches.size === 0 || !flowWidth || !flowHeight) return;
    const timer = window.setTimeout(() => {
      void fitView({ nodes: [...matches.keys()].map((id) => ({ id })), padding: MATCH_PADDING, maxZoom: 1, duration: 300 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [active, matches, flowWidth, flowHeight, fitView]);

  /** Enter / Shift+Enter: centre the next or previous match, close enough to read its columns. */
  const jump = useCallback(
    (step: 1 | -1) => {
      if (matchOrder.length === 0) return;
      const next =
        cursor === null
          ? step === 1
            ? 0
            : matchOrder.length - 1
          : (cursor + step + matchOrder.length) % matchOrder.length;
      const table = matchOrder[next];
      const at = moved[table.id] ?? layout.positions[table.id];
      if (!at) return;
      setCursor(next);
      setPicked(new Set([table.id]));
      void setCenter(at.x + TABLE_WIDTH / 2, at.y + tableHeight(table, layoutDensity) / 2, {
        zoom: Math.max(getZoom(), 0.85),
        duration: 320,
      });
    },
    [matchOrder, cursor, moved, layout, layoutDensity, setCenter, getZoom],
  );

  // Esc peels back one layer at a time: the picked tables, then the search.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (picked.size) setPicked(NONE);
      else if (query) setQuery('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, picked, query]);

  /** Keeps every table a drag moved — one, or the whole picked group dragged together. */
  const keepPositions = (dragged: SchemaNode[]) => {
    if (dragged.length === 0) return;
    setMoved((current) => {
      const next = { ...current };
      for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      writeStored(positionsKey(activePipeline), next);
      return next;
    });
  };

  const relayout = () => {
    setMoved({});
    writeStored(positionsKey(activePipeline), null);
    window.setTimeout(() => void fitView({ padding: FIT_PADDING, maxZoom: 1, duration: 260 }), 30);
  };

  const undocumented = (tables ?? []).filter((t) => t.columns.length === 0).length;
  const tableCount = matches?.size ?? 0;
  const readout = !query.trim()
    ? null
    : tableCount === 0
      ? 'no match'
      : `${cursor !== null ? `${cursor + 1} of ` : ''}${tableCount} table${tableCount === 1 ? '' : 's'}` +
        (matchedColumns ? ` · ${matchedColumns} column${matchedColumns === 1 ? '' : 's'}` : '');

  return (
    <div className="canvaswrap schema-canvas">
      <ReactFlow
        nodes={rfNodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            setPicked((current) => {
              const next = new Set(current);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            });
            return;
          }
          setPicked(new Set([node.id]));
        }}
        onSelectionEnd={() => {
          // Shift+drag boxes: whatever React Flow selected inside the box becomes the pick.
          setPicked(new Set(getNodes().filter((n) => n.selected).map((n) => n.id)));
        }}
        onNodeDoubleClick={(_event, node) => openSchemaTab(node.id)}
        onNodeDragStop={(_event, _node, dragged) => keepPositions(dragged)}
        onSelectionDragStop={(_event, dragged) => keepPositions(dragged)}
        onPaneClick={() => setPicked(NONE)}
        selectNodesOnDrag={false}
        minZoom={0.15}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elevateNodesOnSelect={false}
        deleteKeyCode={null}
      >
        {chrome && <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid)" />}

        <Panel position="top-left">
          <div className="toolbar">
            <div className="tgroup">
              <input
                id="schema-search"
                className="tsearch"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    jump(event.shiftKey ? -1 : 1);
                  } else if (event.key === 'Escape') {
                    // Clearing the box is this Esc's whole job; keep it from also
                    // reaching the canvas and dropping the picked tables.
                    event.stopPropagation();
                    setQuery('');
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Search tables and columns  /"
                aria-label="Search tables and columns"
                title="Enter: next match · Shift+Enter: previous · Esc: clear"
                spellCheck={false}
              />
              {readout && <span className={`tcount${tableCount === 0 ? ' none' : ''}`}>{readout}</span>}
              {query && (
                <button className="tbtn" aria-label="Clear search" onClick={() => setQuery('')}>
                  ×
                </button>
              )}
            </div>
            <div className="tgroup" role="group" aria-label="Columns shown">
              <span className="tlabel">Columns</span>
              {(Object.keys(DENSITY_LABEL) as DensityChoice[]).map((option) => (
                <button
                  key={option}
                  className="tbtn"
                  aria-pressed={choice === option}
                  title={option === 'auto' ? `Follow the zoom — showing ${DENSITY_LABEL[autoDensity].toLowerCase()} now` : undefined}
                  onClick={() => {
                    setChoice(option);
                    writeStored(DENSITY_KEY, option === 'auto' ? null : option);
                  }}
                >
                  {DENSITY_LABEL[option]}
                </button>
              ))}
            </div>
            <div className="tgroup">
              <button className="tbtn" onClick={() => void fitView({ padding: FIT_PADDING, maxZoom: 1, duration: 260 })}>
                Fit
              </button>
              <button
                className="tbtn"
                disabled={Object.keys(moved).length === 0}
                title="Put every table back where the automatic layout puts it"
                onClick={relayout}
              >
                Re-layout
              </button>
              <span className="zval">{Math.round(zoom * 100)}%</span>
            </div>
            {picked.size > 1 && (
              <div className="tgroup bulk-group">
                <span className="tlabel">{picked.size} tables selected</span>
                <button className="tbtn" onClick={() => setPicked(NONE)}>
                  clear
                </button>
              </div>
            )}
          </div>
        </Panel>

        {error && (
          <Panel position="top-center">
            <div className="canvas-empty">
              <div className="rail-label" style={{ marginBottom: 6 }}>
                Could not load the schema
              </div>
              <p>{error}</p>
            </div>
          </Panel>
        )}

        {!error && tables === null && (
          <Panel position="top-center">
            <div className="canvas-empty">
              <p>Loading tables…</p>
            </div>
          </Panel>
        )}

        {tables && tables.length === 0 && (
          <Panel position="top-center">
            <div className="canvas-empty">
              <div className="rail-label" style={{ marginBottom: 6 }}>
                No tables yet
              </div>
              <p>
                A table appears here once something names it: tick <b>Documented asset</b> on a code's input or output
                in the Flow tab, or add one from the <b>Assets</b> rail.
              </p>
            </div>
          </Panel>
        )}

        {tables && tables.length > 0 && (
          <Panel position="bottom-right">
            <div className="legend">
              <div className="rail-label" style={{ marginBottom: 2 }}>
                {tables.length} tables · {layout.groups.length} schema{layout.groups.length === 1 ? '' : 's'}
              </div>
              {undocumented > 0 && (
                <div className="li">
                  <span className="sw undoc" />
                  {undocumented} without a schema
                </div>
              )}
              <div className="li">
                <span className="tbl-test ok" />
                column has a test
              </div>
              <div className="li">
                <span className="tbl-test no" />
                no test
              </div>
            </div>
          </Panel>
        )}

        {chrome && (
          <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={0}
          nodeColor={(node) =>
            picked.has(node.id)
              ? 'var(--accent)'
              : (node as TableFlowNode).data.table.columns.length
                ? 'var(--t-sql)'
                : 'var(--line)'
          }
          maskColor="var(--paper)"
          style={{ width: 196, height: 112 }}
          />
        )}
      </ReactFlow>
    </div>
  );
}
