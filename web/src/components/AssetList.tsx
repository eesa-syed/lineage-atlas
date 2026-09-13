import { useEffect, useMemo, useState } from 'react';
import { useAtlas } from '../state/store';
import { FilterPanel } from './FilterPanel';
import { codeColor, isDateFiltered, primaryTag, tagColor, withinDates, type AssetSummary } from '../types';

/** The asset catalogue: every table this pipeline documents, and its coverage. */
export function AssetList() {
  const assets = useAtlas((s) => s.assets);
  const query = useAtlas((s) => s.query);
  const tagFilter = useAtlas((s) => s.tagFilter);
  const dateFilter = useAtlas((s) => s.dateFilter);
  const groupBy = useAtlas((s) => s.assetGroupBy);
  const loadAssets = useAtlas((s) => s.loadAssets);
  const newAsset = useAtlas((s) => s.newAsset);
  const removeAsset = useAtlas((s) => s.removeAsset);
  const openSchemaTab = useAtlas((s) => s.openSchemaTab);
  const select = useAtlas((s) => s.select);
  const setGroupBy = useAtlas((s) => s.setAssetGroupBy);

  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((d) => {
      if (!withinDates(d, dateFilter)) return false;
      // The owner is the asset's own now, so it is worth searching as well as
      // grouping by — "who looks after this?" is asked from both directions.
      if (q && ![d.name, d.owner, d.producedBy?.name ?? ''].some((f) => f.toLowerCase().includes(q))) return false;
      // An asset carries no tags of its own — a tag filter matches the tags of
      // whatever code produces it, the same way the tag chips are labelled.
      if (tagFilter.size && !(d.producedBy && d.producedBy.tags.some((t) => tagFilter.has(t)))) return false;
      return true;
    });
  }, [assets, query, tagFilter, dateFilter]);

  /**
   * Sections mirror the codes rail: whatever the chosen field actually
   * contains, since an asset has no fixed classification of its own.
   */
  const grouped = useMemo(() => {
    // Same as the codes rail: nothing matched means no sections, so the empty
    // state can explain itself instead of an empty heading standing in for it.
    if (visible.length === 0) return [];
    if (groupBy === 'none') return [{ key: 'all', label: 'All assets', items: visible }];

    const buckets = new Map<string, AssetSummary[]>();
    for (const asset of visible) {
      const key =
        groupBy === 'tag'
          ? asset.producedBy
            ? primaryTag(asset.producedBy)
            : 'no producer'
          : groupBy === 'owner'
            ? asset.owner.trim() || 'Unassigned'
            : groupBy === 'materialization'
              ? asset.materialization.trim() || 'unspecified'
              : asset.producedBy?.name ?? 'No producer';
      buckets.set(key, [...(buckets.get(key) ?? []), asset]);
    }

    return [...buckets.entries()]
      .map(([key, items]) => ({ key, label: key, items }))
      .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
  }, [visible, groupBy]);

  const undocumented = assets.filter((d) => d.columnCount === 0).length;
  const filtering = query.trim().length > 0 || tagFilter.size > 0 || isDateFiltered(dateFilter);

  return (
    <>
      <div className="sec">
        <div className="sec-head">
          <span className="rail-label">Catalogue · {assets.length}</span>
          <button className="linkbtn" onClick={() => setDraft('')}>
            + new asset
          </button>
        </div>

        {draft !== null ? (
          <>
            <input
              className="pipe-input"
              autoFocus
              value={draft}
              placeholder="analytics.my_table ↵"
              aria-label="New asset name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  void newAsset(draft);
                  setDraft(null);
                }
                if (e.key === 'Escape') setDraft(null);
              }}
            />
            <div className="hint">Name it as it appears in the warehouse.</div>
          </>
        ) : (
          <div className="hint">
            {filtering ? (
              <>
                <b className="mono">{visible.length}</b> of {assets.length} assets match
              </>
            ) : undocumented > 0 ? (
              <>
                <b className="mono">{undocumented}</b> of {assets.length} still have no columns documented.
              </>
            ) : (
              <>Every asset has a documented schema.</>
            )}
          </div>
        )}
      </div>

      <FilterPanel idPrefix="assets" />

      <div className="groupbar">
        <label className="rail-label" htmlFor="asset-groupby">
          Group by
        </label>
        <select
          id="asset-groupby"
          className="group-select"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
        >
          <option value="none">Nothing — show all</option>
          <option value="tag">Producer's main tag</option>
          <option value="owner">Owner</option>
          <option value="materialization">Materialization</option>
          <option value="producer">Producer</option>
        </select>
      </div>

      <div className="scroll">
        {grouped.length === 0 &&
          (assets.length === 0 ? (
            <div className="empty">
              No assets yet.
              <br />
              <span style={{ fontSize: 11 }}>
                Name one as a code's input or output, or use <b>+ new asset</b>.
              </span>
            </div>
          ) : (
            <div className="empty">
              {query.trim() ? (
                <>
                  No asset matches <b className="mono">{query}</b>
                </>
              ) : (
                <>
                  No asset is left by these filters.
                  <br />
                  Widen the date window or clear a tag.
                </>
              )}
            </div>
          ))}

        {grouped.map((group) => (
          <div key={group.key}>
            {groupBy !== 'none' && (
              <div className="group-h">
                {groupBy === 'tag' && <span className="gdot" style={{ background: tagColor(group.key) }} />}
                <span className="rail-label">{group.label}</span>
                <span className="ln" />
                <span className="rail-label">{group.items.length}</span>
              </div>
            )}
            {group.items.map((asset) => (
              <div className="dsrow" key={asset.id}>
                <button className="dsrow-main" onClick={() => openSchemaTab(asset.id)}>
                  <span className="dsname">{asset.name}</span>
                  <span className="dsmeta">
                    {asset.columnCount > 0 ? (
                      <>
                        {asset.columnCount} cols · {asset.testedColumns} tested
                      </>
                    ) : (
                      <span className="undoc">no schema yet</span>
                    )}
                    {' · '}
                    {asset.consumerCount} used by
                  </span>
                  {asset.producedBy && (
                    <span className="dsfrom">
                      <span className="sw" style={{ background: codeColor(asset.producedBy) }} />
                      {asset.producedBy.name}
                    </span>
                  )}
                </button>
                <span className="dsactions">
                  {asset.producedBy && (
                    <button
                      className="linkbtn"
                      title="Show the code that produces it"
                      onClick={() => select(asset.producedBy!.id, true)}
                    >
                      ◎
                    </button>
                  )}
                  <button
                    className="linkbtn danger"
                    title="Remove from the catalogue"
                    onClick={() => void removeAsset(asset.id)}
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
