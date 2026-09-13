import { useEffect, useMemo, useRef } from 'react';
import { AssetList } from './AssetList';
import { BulkActions } from './BulkActions';
import { FilterPanel } from './FilterPanel';
import { useAtlas } from '../state/store';
import { matches } from '../lib/lineage';
import { STATUS_COLOR, codeColor, isDateFiltered, primaryTag, type Code } from '../types';

function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  );
}

export function SearchRail() {
  const codes = useAtlas((s) => s.codes);
  const edges = useAtlas((s) => s.edges);
  const query = useAtlas((s) => s.query);
  const tagFilter = useAtlas((s) => s.tagFilter);
  const dateFilter = useAtlas((s) => s.dateFilter);
  const selectedId = useAtlas((s) => s.selectedId);
  const connectFrom = useAtlas((s) => s.connectFrom);
  const selectedIds = useAtlas((s) => s.selectedIds);
  const bulkConnectFrom = useAtlas((s) => s.bulkConnectFrom);

  const setQuery = useAtlas((s) => s.setQuery);
  const select = useAtlas((s) => s.select);
  const connect = useAtlas((s) => s.connect);
  const connectTo = useAtlas((s) => s.connectTo);
  const notify = useAtlas((s) => s.notify);
  const toggleMultiSelect = useAtlas((s) => s.toggleMultiSelect);
  const selectRange = useAtlas((s) => s.selectRange);
  const selectMany = useAtlas((s) => s.selectMany);
  const clearMultiSelect = useAtlas((s) => s.clearMultiSelect);

  const mode = useAtlas((s) => s.mode);
  const railTab = useAtlas((s) => s.railTab);
  const setRailTab = useAtlas((s) => s.setRailTab);
  const groupBy = useAtlas((s) => s.groupBy);
  const setGroupBy = useAtlas((s) => s.setGroupBy);
  const searchRef = useRef<HTMLInputElement>(null);

  // Starting a connection (toolbar, inspector, context menu, or the `C` key)
  // picks the source but leaves the target to be found — jump straight into
  // search instead of making the user go hunt for it on the canvas. The
  // target list lives under the Codes tab, so switch to it if needed.
  useEffect(() => {
    if (!connectFrom && !bulkConnectFrom) return;
    setRailTab('codes');
    searchRef.current?.focus();
  }, [connectFrom, bulkConnectFrom, setRailTab]);

  const filters = useMemo(() => ({ query, tags: tagFilter, dates: dateFilter }), [query, tagFilter, dateFilter]);
  const visible = useMemo(() => codes.filter((n) => matches(n, filters)), [codes, filters]);
  /**
   * Sections are whatever the chosen field actually contains — there is no
   * fixed vocabulary, so a pipeline using invented tags groups just as well as
   * the seeded warehouse.
   */
  const grouped = useMemo(() => {
    // No sections at all when nothing matched, so the empty state below gets a
    // chance to say why. Ungrouped, this used to render an "All codes" heading
    // with nothing under it, which reads as a bug rather than as a filter.
    if (visible.length === 0) return [];
    if (groupBy === 'none') return [{ key: 'all', label: 'All codes', items: visible }];

    const buckets = new Map<string, Code[]>();
    for (const code of visible) {
      const key =
        groupBy === 'tag' ? primaryTag(code) : groupBy === 'owner' ? code.owner.trim() || 'Unassigned' : code.status;
      buckets.set(key, [...(buckets.get(key) ?? []), code]);
    }

    const sections = [...buckets.entries()].map(([key, items]) => ({ key, label: key, items }));
    if (groupBy === 'status') {
      const order = ['inactive', 'active'];
      return sections.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    }
    // Biggest group first, then alphabetically — the useful order when the
    // section names carry no inherent sequence.
    return sections.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
  }, [visible, groupBy]);

  // The on-screen top-to-bottom order, across every group — what a Shift+click
  // range should walk, since that's the order the user actually sees.
  const flatOrder = useMemo(() => grouped.flatMap((g) => g.items.map((c) => c.id)), [grouped]);

  const connectInto = (target: Code) => {
    if (bulkConnectFrom) {
      void connectTo(target.id);
      return;
    }
    const source = connectFrom ?? selectedId;
    if (!source) {
      notify('Select a source code first, then use ⇢ to connect it forward.', 'error');
      return;
    }
    void connect(source, target.id);
  };

  const rowClick = (code: Code, e: React.MouseEvent) => {
    if (mode === 'connect') {
      connectInto(code);
      return;
    }
    if (e.shiftKey) {
      selectRange(code.id, flatOrder);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      toggleMultiSelect(code.id);
      return;
    }
    select(code.id, true);
  };

  const filtering = query.trim().length > 0 || tagFilter.size > 0 || isDateFiltered(dateFilter);

  return (
    <aside className="rail">
      <div className="railtabs" role="tablist">
        <button role="tab" aria-selected={railTab === 'codes'} onClick={() => setRailTab('codes')}>
          Codes
        </button>
        <button role="tab" aria-selected={railTab === 'assets'} onClick={() => setRailTab('assets')}>
          Assets
        </button>
      </div>

      <div className="sec">
        <div className="search">
          <svg className="ic" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.6 8.6L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            id="atlas-search"
            type="search"
            value={query}
            placeholder={
              mode === 'connect' ? 'Find the code to connect to…' : railTab === 'codes' ? 'Search codes, tags, columns, logic…' : 'Search assets…'
            }
            aria-label="Search codes"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="clr" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>
              ×
            </button>
          )}
        </div>
        {railTab === 'codes' && (
        <div className="hint">
          {mode === 'connect' ? (
            bulkConnectFrom ? (
              <>
                Pick a target — connects <b className="mono">{bulkConnectFrom.length}</b> codes forward. <span className="kbd">Esc</span> cancels.
              </>
            ) : (
              <>Click a result to connect it — <span className="kbd">Esc</span> cancels.</>
            )
          ) : filtering ? (
            <>
              <b className="mono">{visible.length}</b> of {codes.length} codes match
              {visible.length > 0 && (
                <>
                  {' · '}
                  <button className="linkbtn" onClick={() => selectMany(visible.map((c) => c.id))}>
                    select all
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {codes.length} codes · {edges.length} edges in this graph
            </>
          )}
        </div>
        )}
      </div>

      {railTab === 'assets' && <AssetList />}

      {railTab === 'codes' && (
      <>
      {selectedIds.size > 0 && mode !== 'connect' && (
        <div className="sec bulkbar">
          <div className="sec-head">
            <span className="rail-label">{selectedIds.size} selected</span>
            <button className="linkbtn" onClick={clearMultiSelect}>
              clear
            </button>
          </div>
          <div className="bulk-actions">
            <BulkActions ids={[...selectedIds]} />
          </div>
        </div>
      )}

      <FilterPanel idPrefix="codes" />

      <div className="groupbar">
        <label className="rail-label" htmlFor="groupby">
          Group by
        </label>
        <select
          id="groupby"
          className="group-select"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
        >
          <option value="none">Nothing — show all</option>
          <option value="tag">Main tag</option>
          <option value="owner">Owner</option>
          <option value="status">Status</option>
        </select>
      </div>

      <div className={`scroll${selectedIds.size > 0 ? ' bulk-active' : ''}`}>
        {grouped.length === 0 &&
          (codes.length === 0 ? (
            <div className="empty">
              This pipeline has no codes yet.
              <br />
              <span style={{ fontSize: 11 }}>
                Add the first one with <b>＋ Code</b> on the canvas.
              </span>
            </div>
          ) : (
            <div className="empty">
              {query.trim() ? (
                <>
                  No code matches <b className="mono">{query}</b>
                  <br />
                  Try a column name, an owner, or a file path.
                </>
              ) : (
                <>
                  No code is left by these filters.
                  <br />
                  Widen the date window or clear a tag.
                </>
              )}
            </div>
          ))}
        {grouped.map((group) => (
          <div key={group.key}>
            <div className="group-h">
              {groupBy === 'tag' && <span className="gdot" style={{ background: codeColor({ tags: [group.key] }) }} />}
              {groupBy === 'status' && <span className="gdot round" style={{ background: STATUS_COLOR[group.key as Code['status']] }} />}
              <span className="rail-label">{group.label}</span>
              <span className="ln" />
              {mode !== 'connect' && (
                <button
                  className="linkbtn"
                  title="Select every code in this group for a bulk action"
                  onClick={() => selectMany([...selectedIds, ...group.items.map((c) => c.id)])}
                >
                  select
                </button>
              )}
              <span className="rail-label">{group.items.length}</span>
            </div>
            {group.items.map((code) => (
              <button
                key={code.id}
                className={`nrow${selectedIds.has(code.id) ? ' msel' : ''}`}
                aria-current={selectedId === code.id}
                onClick={(e) => rowClick(code, e)}
              >
                {mode === 'connect' ? (
                  <span />
                ) : (
                  <span
                    className="cbx"
                    role="checkbox"
                    aria-checked={selectedIds.has(code.id)}
                    title="Select for a bulk action (⌘/Ctrl+click a row, or Shift+click for a range)"
                    onClick={(e) => { e.stopPropagation(); toggleMultiSelect(code.id); }}
                  >
                    {selectedIds.has(code.id) && '✓'}
                  </span>
                )}
                <span className="sw" style={{ background: codeColor(code) }} />
                <span style={{ minWidth: 0 }}>
                  <span className="nm">
                    <Highlighted text={code.name} query={query} />
                  </span>
                  <span className="mt">{code.owner || code.status}</span>
                </span>
                <span
                  className="linkbtn"
                  role="button"
                  tabIndex={0}
                  title="Connect the selected code forward into this one"
                  onClick={(e) => { e.stopPropagation(); connectInto(code); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); connectInto(code); } }}
                >
                  ⇢
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      </>
      )}
    </aside>
  );
}
