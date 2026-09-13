import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import DagCodeCard, { type DagFlowNode } from './DagCode';
import { NewCodeForm } from './NewCodeForm';
import { BulkActions } from './BulkActions';
import { useAtlas } from '../state/store';
import { lineageSet, matches } from '../lib/lineage';
import { codeColor, primaryTag, tagColor } from '../types';

const nodeTypes = { dag: DagCodeCard };

export function GraphCanvas() {
  const codes = useAtlas((s) => s.codes);
  const edges = useAtlas((s) => s.edges);
  const selectedId = useAtlas((s) => s.selectedId);
  const focusRequest = useAtlas((s) => s.focusRequest);
  const query = useAtlas((s) => s.query);
  const tagFilter = useAtlas((s) => s.tagFilter);
  const dateFilter = useAtlas((s) => s.dateFilter);
  const mode = useAtlas((s) => s.mode);
  const connectFrom = useAtlas((s) => s.connectFrom);

  const select = useAtlas((s) => s.select);
  const moveCode = useAtlas((s) => s.moveCode);
  const connect = useAtlas((s) => s.connect);
  const connectTo = useAtlas((s) => s.connectTo);
  const cancelConnect = useAtlas((s) => s.cancelConnect);
  const setMode = useAtlas((s) => s.setMode);
  const openMenu = useAtlas((s) => s.openMenu);
  const openFlowTab = useAtlas((s) => s.openFlowTab);
  const duplicate = useAtlas((s) => s.duplicate);
  const startConnect = useAtlas((s) => s.startConnect);
  const notify = useAtlas((s) => s.notify);
  const removeEdge = useAtlas((s) => s.removeEdge);
  // Hidden behind another tab this canvas measures zero, and its backdrop and
  // minimap would compute their geometry from that — NaN attributes, every time
  // something re-renders it off screen. Nothing to draw there anyway.
  const showing = useAtlas((s) => s.activeTab === 'graph');
  const selectedIds = useAtlas((s) => s.selectedIds);
  const bulkConnectFrom = useAtlas((s) => s.bulkConnectFrom);
  const toggleMultiSelect = useAtlas((s) => s.toggleMultiSelect);
  const selectMany = useAtlas((s) => s.selectMany);
  const clearMultiSelect = useAtlas((s) => s.clearMultiSelect);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<DagFlowNode>([]);
  const { fitView, setCenter, getZoom, screenToFlowPosition, getNodes } = useReactFlow<DagFlowNode>();
  const [newCodeAt, setNewCodeAt] = useState<{ x: number; y: number } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [detailed, setDetailed] = useState(() => {
    try {
      return localStorage.getItem('atlas-card-detail') !== 'compact';
    } catch {
      return true;
    }
  });
  const zoom = useStore((s) => s.transform[2]);
  // React Flow's own measurement of the viewport, not the DOM box: it lags a beat
  // behind a pane becoming visible, and framing against a zero-size viewport sends
  // the transform through NaN.
  const flowWidth = useStore((s) => s.width);
  const flowHeight = useStore((s) => s.height);
  /** Draw the backdrop and minimap only once this canvas is both on screen and
   * measured: either half missing makes them compute their geometry from zero. */
  const chrome = showing && flowWidth > 0 && flowHeight > 0;
  const didFit = useRef(false);
  const hasPanned = useRef(false);
  /** The canvas's last measured box, to tell a real resize from a pane reappearing. */
  const lastSize = useRef({ width: 0, height: 0 });
  /** React Flow's live viewport size, readable from inside the resize callback. */
  const flowSize = useRef({ width: 0, height: 0 });
  flowSize.current = { width: flowWidth, height: flowHeight };
  /** The focus request already centred on, so a later resize cannot re-centre. */
  const centredFor = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const lineage = useMemo(() => lineageSet(selectedId, edges), [selectedId, edges]);
  const filters = useMemo(() => ({ query, tags: tagFilter, dates: dateFilter }), [query, tagFilter, dateFilter]);

  useEffect(() => {
    setRfNodes(
      codes.map<DagFlowNode>((code) => ({
        id: code.id,
        type: 'dag',
        position: { x: code.x, y: code.y },
        // With several codes picked, the picked set is the selection; otherwise
        // the one selected code is.
        selected: selectedIds.size > 0 ? selectedIds.has(code.id) : code.id === selectedId,
        data: {
          code,
          dim: !matches(code, filters),
          inLineage: !!lineage?.has(code.id),
          isConnectSource: connectFrom === code.id,
          detailed,
        },
      })),
    );
  }, [codes, selectedId, selectedIds, filters, lineage, connectFrom, detailed, setRfNodes]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => {
        const hot = !!lineage && lineage.has(edge.source) && lineage.has(edge.target);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'default',
          selected: edge.id === selectedEdgeId,
          className: [edge.id === selectedEdgeId ? 'picked' : '', hot ? 'lineage' : lineage ? 'muted' : '']
            .filter(Boolean)
            .join(' ') || undefined,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: hot || edge.id === selectedEdgeId ? 'var(--accent)' : 'var(--line)',
          },
        };
      }),
    [edges, lineage, selectedEdgeId],
  );

  // Frame the whole graph once the first load has produced codes, then keep it
  // framed while the user has not moved the viewport themselves — a pane that
  // changes size (window resize, panel toggle) would otherwise strand the graph
  // off-centre.
  useEffect(() => {
    if (rfNodes.length === 0 || !flowWidth || !flowHeight) return;
    const frame = () => fitView({ padding: 0.12, duration: didFit.current ? 200 : 0 });
    const raf = window.requestAnimationFrame(() => {
      frame();
      didFit.current = true;
    });
    const wrap = wrapRef.current;
    const observer = wrap && !hasPanned.current
      ? new ResizeObserver(() => {
          const width = wrap.clientWidth;
          const height = wrap.clientHeight;
          const previous = lastSize.current;
          lastSize.current = { width, height };
          // Two sizes to tell apart. A pane behind another tab measures zero, and
          // coming back is a 0 -> N change, not a resize: the viewport is already
          // framed, and re-framing here would fight a centring that arrived with the
          // tab switch (and race it through NaN, since d3's zoom interpolation
          // divides by the extent). Only a real resize, between two live sizes,
          // should reframe.
          const wasVisible = previous.width > 0 && previous.height > 0;
          const changed = previous.width !== width || previous.height !== height;
          const measured = flowSize.current.width > 0 && flowSize.current.height > 0;
          if (!hasPanned.current && width > 0 && height > 0 && wasVisible && changed && measured) frame();
        })
      : null;
    if (wrap && observer) observer.observe(wrap);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [rfNodes.length, flowWidth, flowHeight, fitView]);

  // Centre on a code when something outside the canvas asks to focus it.
  useEffect(() => {
    // A jump from another tab (a table's code chip, a schema page's lineage chip)
    // arrives while this pane is still hidden and React Flow still measures it as
    // zero, where centring would run the transform through NaN. Skipping then is
    // safe: this runs again the moment the pane has a size, and `centredFor` keeps
    // a later resize from re-centring on a request already served.
    if (!focusRequest || !selectedId || !flowWidth || !flowHeight) return;
    if (focusRequest === centredFor.current) return;
    const code = codes.find((n) => n.id === selectedId);
    if (!code) return;
    centredFor.current = focusRequest;
    void setCenter(code.x + 99, code.y + 52, { zoom: Math.max(getZoom(), 0.7), duration: 320 });
  }, [focusRequest, selectedId, codes, flowWidth, flowHeight, setCenter, getZoom]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (mode === 'connect') {
        // A pending bulk connect is waiting for its one target too.
        if (connectFrom || bulkConnectFrom) void connectTo(node.id);
        else startConnect(node.id);
        return;
      }
      // Shift+click adds or removes one code, as in most canvas tools; ⌘/Ctrl+click
      // does too. On a Mac, Ctrl+click is the system right-click and opens the
      // code's menu instead, so Shift is the one that works everywhere.
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        // Starting a multi-selection keeps the code already selected in it, the
        // way a file manager does; after that each click toggles one code.
        if (selectedIds.size === 0 && selectedId && selectedId !== node.id) selectMany([selectedId, node.id]);
        else toggleMultiSelect(node.id);
        return;
      }
      select(node.id);
    },
    [mode, connectFrom, bulkConnectFrom, connectTo, startConnect, select, selectedIds, selectedId, selectMany, toggleMultiSelect],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) void connect(connection.source, connection.target);
    },
    [connect],
  );

  const selectedCode = codes.find((n) => n.id === selectedId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  // Backspace/Delete removes the picked link — the banner is the discoverable
  // route, this is the fast one.
  useEffect(() => {
    if (!selectedEdgeId) return;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void removeEdge(selectedEdgeId);
        setSelectedEdgeId(null);
      }
      if (event.key === 'Escape') setSelectedEdgeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEdgeId, removeEdge]);

  const legendTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const code of codes) {
      const tag = primaryTag(code);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 7);
  }, [codes]);

  return (
    <div className={`canvaswrap${mode === 'connect' ? ' connect-mode' : ''}`} ref={wrapRef}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => {
          setSelectedEdgeId(null);
          onNodeClick(event, node);
        }}
        onNodeDoubleClick={(_e, node) => openFlowTab(node.id)}
        // Dragging a picked code moves every picked code with it, so every one of
        // them has to be saved — not just the one under the pointer.
        onNodeDragStop={(_e, _node, dragged) => {
          for (const n of dragged) void moveCode(n.id, Math.round(n.position.x), Math.round(n.position.y));
        }}
        onSelectionDragStop={(_e, dragged) => {
          for (const n of dragged) void moveCode(n.id, Math.round(n.position.x), Math.round(n.position.y));
        }}
        // Shift+drag boxes: whatever React Flow selected inside the box becomes the
        // bulk selection, so it can be tagged or connected like one picked in the rail.
        onSelectionEnd={() => selectMany(getNodes().filter((n) => n.selected).map((n) => n.id))}
        selectNodesOnDrag={false}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          select(node.id);
          openMenu({ x: event.clientX, y: event.clientY, codeId: node.id });
        }}
        onPaneClick={() => {
          setSelectedEdgeId(null);
          if (mode === 'connect') cancelConnect();
          else select(null);
        }}
        onEdgeClick={(event, edge) => {
          event.stopPropagation();
          setSelectedEdgeId(edge.id);
        }}
        onConnect={onConnect}
        onMoveStart={(event) => { if (event) hasPanned.current = true; }}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        elevateNodesOnSelect={false}
        deleteKeyCode={null}
      >
        {chrome && <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid)" />}

        <Panel position="top-left">
          <div className="toolbar">
            <div className="tgroup">
              <button className="tbtn" aria-pressed={mode === 'select'} onClick={() => setMode('select')}>
                ⌖ Select <span className="k">V</span>
              </button>
              <button
                className="tbtn"
                aria-pressed={mode === 'connect'}
                onClick={() => (selectedCode ? startConnect(selectedCode.id) : setMode('connect'))}
              >
                ⇢ Connect <span className="k">C</span>
              </button>
            </div>
            <div className="tgroup">
              <button
                className="tbtn"
                aria-pressed={!!newCodeAt}
                onClick={() => {
                  if (newCodeAt) return setNewCodeAt(null);
                  // Drop it where the user is looking — except in an empty
                  // pipeline, where "where you're looking" is meaningless and
                  // the first code should simply start the graph at the origin.
                  const rect = wrapRef.current?.getBoundingClientRect();
                  if (codes.length === 0 || !rect) return setNewCodeAt({ x: 40, y: 70 });
                  const centre = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                  setNewCodeAt({ x: Math.round(centre.x - 99), y: Math.round(centre.y - 52) });
                }}
              >
                ＋ Code
              </button>
            </div>
            <div className="tgroup">
              <button
                className="tbtn"
                aria-pressed={detailed}
                title="Show each code's inputs and outputs on its card"
                onClick={() => {
                  const next = !detailed;
                  setDetailed(next);
                  try {
                    localStorage.setItem('atlas-card-detail', next ? 'detailed' : 'compact');
                  } catch {
                    // A browser refusing storage still gets the toggle for this session.
                  }
                }}
              >
                ▤ I/O
              </button>
              <button className="tbtn" onClick={() => void fitView({ padding: 0.12, duration: 260 })}>
                Fit
              </button>
              <span className="zval">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="tgroup">
              <button
                className="tbtn"
                onClick={() => (selectedCode ? void duplicate(selectedCode.id, false) : notify('Select a code first.', 'error'))}
              >
                ⧉ Duplicate <span className="k">D</span>
              </button>
              <button
                className="tbtn"
                onClick={() => (selectedCode ? startConnect(selectedCode.id) : notify('Select a code to connect from.', 'error'))}
              >
                ⇢ Connect forward
              </button>
            </div>
            {/* Several codes picked: their actions join the toolbar, where they wrap with
                it instead of floating into the minimap on a narrow canvas. */}
            {selectedIds.size > 0 && mode !== 'connect' && (
              <div className="tgroup bulk-group">
                <span className="tlabel">{selectedIds.size} selected</span>
                <BulkActions ids={[...selectedIds]} variant="toolbar" />
                <button className="tbtn" onClick={clearMultiSelect}>
                  clear
                </button>
              </div>
            )}
          </div>
        </Panel>

        {newCodeAt && (
          <Panel position="top-left">
            <div style={{ marginTop: 74 }}>
              <NewCodeForm at={newCodeAt} onClose={() => setNewCodeAt(null)} />
            </div>
          </Panel>
        )}

        {selectedEdge && (
          <Panel position="top-center">
            <div className="banner" style={{ marginTop: 34 }}>
              <span className="mono" style={{ fontSize: 11 }}>
                {codes.find((n) => n.id === selectedEdge.source)?.name} ⇢ {codes.find((n) => n.id === selectedEdge.target)?.name}
              </span>
              <button
                onClick={() => {
                  void removeEdge(selectedEdge.id);
                  setSelectedEdgeId(null);
                }}
              >
                remove link
              </button>
              <button onClick={() => setSelectedEdgeId(null)}>cancel</button>
            </div>
          </Panel>
        )}

        {connectFrom && (
          <Panel position="top-center">
            <div className="banner" style={{ marginTop: 34 }}>
              <span>
                Connecting from {codes.find((n) => n.id === connectFrom)?.name} — click a target code, drag from its
                handle, or pick one in the left rail.
              </span>
              <button onClick={cancelConnect}>cancel</button>
            </div>
          </Panel>
        )}

        {bulkConnectFrom && (
          <Panel position="top-center">
            <div className="banner" style={{ marginTop: 34 }}>
              <span>
                Connecting {bulkConnectFrom.length} codes forward — click the one code they all feed, or pick it
                in the left rail.
              </span>
              <button onClick={cancelConnect}>cancel</button>
            </div>
          </Panel>
        )}

        {codes.length === 0 && !newCodeAt && (
          <Panel position="top-center">
            <div className="canvas-empty">
              <div className="rail-label" style={{ marginBottom: 6 }}>
                Empty pipeline
              </div>
              <p>
                Nothing documented here yet. Use <b>＋ Code</b> above to add the first step, then drag between
                handles to connect them.
              </p>
            </div>
          </Panel>
        )}

        {legendTags.length > 0 && (
          <Panel position="bottom-right">
            <div className="legend">
              <div className="rail-label" style={{ marginBottom: 2 }}>
                Main tags
              </div>
              {legendTags.map(({ tag, count }) => (
                <div className="li" key={tag}>
                  <span className="sw" style={{ background: tagColor(tag) }} />
                  <span className="mono">{tag}</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{count}</span>
                </div>
              ))}
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
            (node as DagFlowNode).id === selectedId
              ? 'var(--accent)'
              : codeColor((node as DagFlowNode).data.code)
          }
          maskColor="var(--paper)"
          style={{ width: 196, height: 112 }}
          />
        )}
      </ReactFlow>
    </div>
  );
}
