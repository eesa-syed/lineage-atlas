import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { AssetLinkInput, AssetSummary, Code, CodePatch, DateRange, GraphEdge, Pipeline, ProvenanceSource, VersionInfo } from '../types';
import { ANY_DATE, codeColor } from '../types';

export type Mode = 'select' | 'connect';
export type GroupBy = 'none' | 'tag' | 'owner' | 'status';
/** An asset has no tags of its own — grouping by tag falls back to its
 * producing code's main tag. Owner, materialization and producer are its own. */
export type AssetGroupBy = 'none' | 'tag' | 'owner' | 'materialization' | 'producer';

const ASSET_GROUPINGS: AssetGroupBy[] = ['tag', 'owner', 'materialization', 'producer'];

function storedGroupBy(): GroupBy {
  try {
    const value = localStorage.getItem('atlas-group-by');
    return value === 'tag' || value === 'owner' || value === 'status' ? value : 'none';
  } catch {
    return 'none';
  }
}

function storedAssetGroupBy(): AssetGroupBy {
  try {
    const value = localStorage.getItem('atlas-asset-group-by') as AssetGroupBy | null;
    return value && ASSET_GROUPINGS.includes(value) ? value : 'none';
  } catch {
    return 'none';
  }
}

/**
 * Which pipeline and code were open — read once on boot so a refresh lands
 * back where the user left off instead of resetting to the first code in the
 * seeded pipeline, and written back out whenever either changes.
 */
interface StoredSession {
  activePipeline?: string;
  selectedId?: string | null;
}

function readSession(): StoredSession {
  try {
    const raw = localStorage.getItem('atlas-session');
    return raw ? (JSON.parse(raw) as StoredSession) : {};
  } catch {
    return {};
  }
}

function writeSession(patch: StoredSession): void {
  try {
    localStorage.setItem('atlas-session', JSON.stringify({ ...readSession(), ...patch }));
  } catch {
    // A browser refusing storage still gets the session for this tab.
  }
}

export interface Tab {
  id: string;
  kind: 'graph' | 'tables' | 'flow' | 'schema';
  label: string;
  color: string;
  /** Code id for a flow tab, asset id for a schema tab. */
  refId?: string;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface AtlasState {
  pipelines: Pipeline[];
  activePipeline: string;
  codes: Code[];
  edges: GraphEdge[];
  tagCounts: { tag: string; count: number }[];
  assets: AssetSummary[];
  railTab: 'codes' | 'assets';
  groupBy: GroupBy;
  assetGroupBy: AssetGroupBy;
  status: 'loading' | 'ready' | 'error';
  loadError: string | null;
  /** What the API reports about itself, once known. Null until the first load
   * answers, and left null if the endpoint is missing — an older server is
   * still perfectly usable, it just cannot say what it is. */
  version: VersionInfo | null;

  selectedId: string | null;
  focusRequest: number;
  query: string;
  tagFilter: Set<string>;
  /** A window on one stewardship date, shared by the Codes and Assets tabs the
   * same way the search box and the tag chips are. */
  dateFilter: DateRange;
  /** Evidence sources to keep — see `Filters.provenance`. */
  provenanceFilter: Set<ProvenanceSource>;
  mode: Mode;
  connectFrom: string | null;
  menu: { x: number; y: number; codeId: string } | null;
  tabs: Tab[];
  activeTab: string;
  toast: Toast | null;

  /** Codes checked for a bulk action (tag-all, connect-all) — independent of
   * `selectedId`, which stays the single code the inspector is reading. */
  selectedIds: Set<string>;
  /** The row a Shift+click range extends from; the last row touched by a
   * plain click or a Ctrl/Cmd+click. */
  multiAnchorId: string | null;
  /** Sources for a bulk "connect forward" — set instead of `connectFrom`
   * while the rail waits for the user to pick one shared target. */
  bulkConnectFrom: string[] | null;

  load: (graphId?: string) => Promise<void>;
  selectPipeline: (graphId: string) => Promise<void>;
  newPipeline: (name: string) => Promise<void>;
  renamePipeline: (graphId: string, name: string) => Promise<void>;
  removePipeline: (graphId: string) => Promise<void>;
  exportPipeline: () => void;
  /** One `.atlas.json` or dbt `manifest.json` — or a manifest and its `catalog.json` together. */
  importPipelineFiles: (files: File[]) => Promise<void>;
  notify: (message: string, tone?: 'info' | 'error') => void;
  dismissToast: (id: number) => void;

  select: (id: string | null, focus?: boolean) => void;
  setQuery: (query: string) => void;
  toggleTagFilter: (tag: string) => void;
  clearTagFilters: () => void;
  toggleProvenanceFilter: (source: ProvenanceSource) => void;
  clearProvenanceFilters: () => void;
  /** Merges into the current window — the field, one bound, or both. */
  setDateFilter: (patch: Partial<DateRange>) => void;
  clearDateFilter: () => void;
  setMode: (mode: Mode) => void;
  openMenu: (menu: { x: number; y: number; codeId: string } | null) => void;

  /** Ctrl/Cmd+click a row — toggle just that one code in the bulk selection. */
  toggleMultiSelect: (id: string) => void;
  /** Shift+click a row — extend the bulk selection from the anchor through it. */
  selectRange: (id: string, order: string[]) => void;
  selectMany: (ids: string[]) => void;
  clearMultiSelect: () => void;
  bulkAddTag: (ids: string[], tag: string) => Promise<void>;
  /** Start picking one shared target for every id in `ids` to connect into. */
  startBulkConnect: (ids: string[]) => void;

  startConnect: (fromId: string) => void;
  cancelConnect: () => void;
  /** Create an edge between two explicit codes — used by handle-to-handle drags. */
  connect: (sourceId: string, targetId: string) => Promise<void>;
  /** Complete a pending "connect forward" against the code the user just picked —
   * routes to `bulkConnect` when the pending connect has multiple sources. */
  connectTo: (targetId: string) => Promise<void>;
  bulkConnect: (sourceIds: string[], targetId: string) => Promise<void>;
  removeEdge: (edgeId: string) => Promise<void>;

  moveCode: (id: string, x: number, y: number) => Promise<void>;
  duplicate: (id: string, withInputs: boolean) => Promise<void>;
  addTag: (id: string, tag: string) => Promise<void>;
  removeTag: (id: string, tag: string) => Promise<void>;
  saveDescription: (id: string, description: string) => Promise<void>;
  saveMetadata: (id: string, patch: CodePatch) => Promise<void>;
  createCode: (input: { name: string; tags: string[]; x: number; y: number }) => Promise<void>;
  setPrimaryTag: (id: string, tag: string) => Promise<void>;
  addAssetLink: (codeId: string, input: AssetLinkInput) => Promise<void>;
  updateAssetLink: (codeId: string, assetLinkId: string, patch: Partial<AssetLinkInput>) => Promise<void>;
  deleteAssetLink: (codeId: string, assetLinkId: string) => Promise<void>;
  relink: () => Promise<void>;
  setRailTab: (tab: 'codes' | 'assets') => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setAssetGroupBy: (groupBy: AssetGroupBy) => void;
  loadAssets: () => Promise<void>;
  newAsset: (name: string) => Promise<void>;
  removeAsset: (assetId: string) => Promise<void>;
  deleteCode: (id: string) => Promise<void>;

  openFlowTab: (codeId: string) => void;
  openSchemaTab: (assetId: string) => void;
  /** Called after a schema save that renamed the asset — see the implementation. */
  assetRenamed: (assetId: string, name: string) => Promise<void>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
}

const GRAPH_TAB: Tab = { id: 'graph', kind: 'graph', label: 'Flow', color: 'var(--accent)' };
/** The pipeline's tables and their columns, drawn as a schema diagram. Permanent
 * like the graph tab: it is a second way of looking at the same pipeline, not a
 * document someone opened. */
const TABLES_TAB: Tab = { id: 'tables', kind: 'tables', label: 'Schema', color: 'var(--t-sql)' };
const FIXED_TABS: Tab[] = [GRAPH_TAB, TABLES_TAB];

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;

/**
 * Folds a write's outcome back into one code: whatever the edit changed, plus
 * the `updatedAt`/`updatedBy` the server moved by making it. Without the second
 * half the inspector goes on naming the *previous* editor until the next full
 * load, which is exactly the field nobody would think to distrust.
 *
 * Deliberately a merge and not a wholesale replacement: a drag in flight has
 * already put newer x/y in the store, and a stale response must not drag the
 * code back across the canvas.
 */
function stamp(
  state: { codes: Code[] },
  id: string,
  saved: Pick<Code, 'updatedAt' | 'updatedBy'>,
  changed: Partial<Code> = {},
): { codes: Code[] } {
  return {
    codes: state.codes.map((n) =>
      n.id === id ? { ...n, ...changed, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : n,
    ),
  };
}

/**
 * For the writes that answer with a whole code: take the server's version
 * wholesale, since it is the one that decided what a hand-set date or a
 * trimmed name actually became. Position is the exception — a drag may have
 * moved the code since the request went out, and a stale x/y would drag it
 * back across the canvas.
 */
function settle(state: { codes: Code[] }, id: string, saved: Code): { codes: Code[] } {
  return { codes: state.codes.map((n) => (n.id === id ? { ...saved, x: n.x, y: n.y } : n)) };
}

export const useAtlas = create<AtlasState>((set, get) => ({
  pipelines: [],
  activePipeline: readSession().activePipeline ?? 'warehouse',
  codes: [],
  edges: [],
  tagCounts: [],
  assets: [],
  railTab: 'codes',
  groupBy: storedGroupBy(),
  assetGroupBy: storedAssetGroupBy(),
  status: 'loading',
  loadError: null,
  version: null,

  selectedId: readSession().selectedId ?? null,
  focusRequest: 0,
  query: '',
  tagFilter: new Set(),
  dateFilter: ANY_DATE,
  provenanceFilter: new Set(),
  mode: 'select',
  connectFrom: null,
  menu: null,
  tabs: FIXED_TABS,
  activeTab: 'graph',
  toast: null,

  selectedIds: new Set(),
  multiAnchorId: null,
  bulkConnectFrom: null,

  async load(graphId) {
    try {
      const pipelines = await api.pipelines();
      // Informational only, so a server too old to answer must not fail the boot.
      if (!get().version) api.version().then((version) => set({ version })).catch(() => {});
      // Fall back to the first pipeline if the requested one has been deleted.
      const wanted = graphId ?? get().activePipeline;
      const active = pipelines.some((p) => p.id === wanted) ? wanted : pipelines[0]?.id;
      if (!active) {
        set({ status: 'error', loadError: 'No pipelines exist yet.' });
        return;
      }
      const graph = await api.graph(active);
      const assets = get().railTab === 'assets' ? await api.assets(active) : get().assets;
      set((s) => ({
        pipelines,
        assets,
        activePipeline: active,
        codes: graph.codes,
        edges: graph.edges,
        tagCounts: graph.tags,
        status: 'ready',
        loadError: null,
        // Open on a code that has documentation to read rather than an empty inspector.
        selectedId:
          s.selectedId && graph.codes.some((n) => n.id === s.selectedId)
            ? s.selectedId
            : graph.codes.find((n) => n.hasFlow)?.id ?? graph.codes[0]?.id ?? null,
      }));
      // Written back so a refresh restores this same pipeline and code — not
      // whatever the seeded default or the first pipeline happens to be.
      writeSession({ activePipeline: active, selectedId: get().selectedId });
    } catch (err) {
      set({ status: 'error', loadError: message(err, 'Could not reach the API.') });
    }
  },

  async selectPipeline(graphId) {
    if (graphId === get().activePipeline) return;
    // Doc tabs point at codes and assets in the pipeline being left behind.
    set({
      activePipeline: graphId,
      selectedId: null,
      query: '',
      tagFilter: new Set(),
      dateFilter: ANY_DATE,
      provenanceFilter: new Set(),
      mode: 'select',
      connectFrom: null,
      menu: null,
      tabs: FIXED_TABS,
      activeTab: 'graph',
      assets: [],
      selectedIds: new Set(),
      multiAnchorId: null,
      bulkConnectFrom: null,
    });
    await get().load(graphId);
    if (get().railTab === 'assets') await get().loadAssets();
  },

  async newPipeline(name) {
    try {
      const pipeline = await api.createPipeline(name);
      await get().selectPipeline(pipeline.id);
      get().notify(`Created pipeline "${pipeline.name}" — add its first code to begin.`);
    } catch (err) {
      get().notify(message(err, 'Could not create that pipeline.'), 'error');
    }
  },

  async renamePipeline(graphId, name) {
    try {
      await api.renamePipeline(graphId, name);
      await get().load();
      get().notify('Pipeline renamed');
    } catch (err) {
      get().notify(message(err, 'Could not rename that pipeline.'), 'error');
    }
  },

  async removePipeline(graphId) {
    try {
      await api.deletePipeline(graphId);
      set({ tabs: FIXED_TABS, activeTab: 'graph', selectedId: null });
      await get().load(get().pipelines.find((p) => p.id !== graphId)?.id);
      get().notify('Pipeline deleted');
    } catch (err) {
      get().notify(message(err, 'Could not delete that pipeline.'), 'error');
    }
  },

  exportPipeline() {
    const { activePipeline, pipelines } = get();
    const name = pipelines.find((p) => p.id === activePipeline)?.name ?? activePipeline;
    // A plain link download keeps the server's Content-Disposition filename.
    const link = document.createElement('a');
    link.href = api.exportUrl(activePipeline);
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    get().notify(`Exported "${name}" as a .atlas.json file`);
  },

  async importPipelineFiles(files) {
    try {
      // Handed over as text: the server parses it, and the browser is spared
      // building a whole pipeline in memory just to stringify it again. A dbt
      // artifact names its kind in the first few hundred bytes, which is all
      // it takes to tell a catalog from the manifest it belongs with.
      const texts = await Promise.all(files.map((f) => f.text()));
      const isCatalog = (text: string) => /\/dbt\/catalog\/v\d+/.test(text.slice(0, 1000));
      const main = texts.find((t) => !isCatalog(t));
      const catalog = texts.find(isCatalog);
      if (!main) throw new Error('That is a dbt catalog.json on its own. Select the manifest.json from the same target/ folder with it.');
      if (texts.length > 2 || (texts.length === 2 && !catalog)) {
        throw new Error('Choose one file, or a dbt manifest.json together with its catalog.json.');
      }
      const { pipeline, source, upgrades, warnings, notes = [], converted } = await api.importPipeline(main, undefined, catalog);
      await get().selectPipeline(pipeline.id);

      // The file landed whole either way, but *how* it landed is worth keeping:
      // it may have come from an older format, or had an edge dropped to keep
      // the graph acyclic. The console holds every note; the toast holds the
      // headline, since one line cannot carry a list.
      if (converted) console.info(`[atlas import] converted — ${converted}`);
      for (const note of upgrades) console.info(`[atlas import] upgraded — ${note}`);
      for (const note of notes) console.info(`[atlas import] filled in — ${note}`);
      for (const note of warnings) console.warn(`[atlas import] repaired — ${note}`);

      const parts = [
        `Imported ${converted ? 'dbt project ' : ''}"${pipeline.name}" — ${pipeline.codeCount} codes, ${pipeline.edgeCount} edges`,
      ];
      if (upgrades.length) parts.push(`upgraded from format ${source.formatVersion}`);
      if (warnings.length === 1) parts.push(warnings[0]);
      else if (warnings.length > 1) parts.push(`${warnings.length} adjustments — see the console`);
      get().notify(parts.join(' · '));
    } catch (err) {
      // Malformed JSON and an over-sized upload are both the server's verdict
      // now, and both arrive with a message worth showing as it stands.
      get().notify(message(err, 'Could not import that file.'), 'error');
    }
  },

  notify(message, tone = 'info') {
    set({ toast: { id: Date.now(), message, tone } });
  },
  dismissToast(id) {
    if (get().toast?.id === id) set({ toast: null });
  },

  select(id, focus = false) {
    // A plain select is exclusive — it's how a bulk selection gets dismissed
    // by just clicking a row normally, the way file managers behave.
    set((s) => ({
      selectedId: id,
      focusRequest: focus ? s.focusRequest + 1 : s.focusRequest,
      selectedIds: new Set(),
      multiAnchorId: null,
    }));
    writeSession({ selectedId: id });
  },
  setQuery(query) { set({ query }); },

  toggleMultiSelect(id) {
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { selectedIds: next, multiAnchorId: id };
    });
  },

  selectRange(id, order) {
    set((s) => {
      const anchor = s.multiAnchorId ?? s.selectedId ?? id;
      const from = order.indexOf(anchor);
      const to = order.indexOf(id);
      const next = new Set(s.selectedIds);
      if (from < 0 || to < 0) {
        next.add(id);
      } else {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i += 1) next.add(order[i]);
      }
      return { selectedIds: next, multiAnchorId: id };
    });
  },

  selectMany(ids) { set({ selectedIds: new Set(ids) }); },
  clearMultiSelect() { set({ selectedIds: new Set(), multiAnchorId: null }); },

  async bulkAddTag(ids, tag) {
    const clean = tag.trim();
    if (!clean || ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => api.addTag(id, clean)));
    set((s) => ({
      codes: s.codes.map((n) => {
        const i = ids.indexOf(n.id);
        const r = i >= 0 ? results[i] : undefined;
        return r?.status === 'fulfilled' ? { ...n, tags: r.value.tags } : n;
      }),
    }));
    await refreshTagCounts(set);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    get().notify(
      ok > 0
        ? `Tagged ${ok} code${ok === 1 ? '' : 's'} · ${clean}${failed ? ` — ${failed} failed` : ''}`
        : `Could not tag those codes.`,
      failed ? 'error' : 'info',
    );
  },

  startBulkConnect(ids) {
    if (ids.length === 0) return;
    set({ mode: 'connect', connectFrom: null, bulkConnectFrom: ids, menu: null });
  },
  setGroupBy(groupBy) {
    set({ groupBy });
    try {
      localStorage.setItem('atlas-group-by', groupBy);
    } catch {
      // A browser refusing storage still gets the choice for this session.
    }
  },

  setRailTab(tab) {
    set({ railTab: tab });
    if (tab === 'assets') void get().loadAssets();
  },

  setAssetGroupBy(groupBy) {
    set({ assetGroupBy: groupBy });
    try {
      localStorage.setItem('atlas-asset-group-by', groupBy);
    } catch {
      // A browser refusing storage still gets the choice for this session.
    }
  },

  async loadAssets() {
    try {
      set({ assets: await api.assets(get().activePipeline) });
    } catch (err) {
      get().notify(message(err, 'Could not load the asset catalogue.'), 'error');
    }
  },

  async newAsset(name) {
    try {
      const asset = await api.createAsset(get().activePipeline, { name });
      await get().loadAssets();
      get().openSchemaTab(asset.id);
      get().notify(`Created ${asset.name} — document its columns`);
    } catch (err) {
      get().notify(message(err, 'Could not create that asset.'), 'error');
    }
  },

  async removeAsset(assetId) {
    try {
      await api.deleteAsset(assetId);
      set((s) => ({
        assets: s.assets.filter((d) => d.id !== assetId),
        tabs: s.tabs.filter((t) => !(t.kind === 'schema' && t.refId === assetId)),
        activeTab: s.tabs.some((t) => t.id === s.activeTab && t.kind === 'schema' && t.refId === assetId) ? 'graph' : s.activeTab,
      }));
      await get().load();
      get().notify('Asset removed from the catalogue');
    } catch (err) {
      get().notify(message(err, 'Could not remove that asset.'), 'error');
    }
  },
  toggleTagFilter(tag) {
    set((s) => {
      const next = new Set(s.tagFilter);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return { tagFilter: next };
    });
  },
  clearTagFilters() { set({ tagFilter: new Set() }); },
  toggleProvenanceFilter(source) {
    set((s) => {
      const next = new Set(s.provenanceFilter);
      if (next.has(source)) next.delete(source); else next.add(source);
      return { provenanceFilter: next };
    });
  },
  clearProvenanceFilters() { set({ provenanceFilter: new Set() }); },
  setDateFilter(patch) { set((s) => ({ dateFilter: { ...s.dateFilter, ...patch } })); },
  clearDateFilter() { set({ dateFilter: ANY_DATE }); },
  setMode(mode) {
    set({
      mode,
      connectFrom: mode === 'connect' ? get().connectFrom : null,
      bulkConnectFrom: mode === 'connect' ? get().bulkConnectFrom : null,
    });
  },
  openMenu(menu) { set({ menu }); },

  startConnect(fromId) { set({ mode: 'connect', connectFrom: fromId, bulkConnectFrom: null, menu: null }); },
  cancelConnect() {
    // Only wipe the search box if it was actually being used to hunt for a
    // connect target — an unrelated Escape press shouldn't clear it.
    const wasConnecting = !!get().connectFrom || !!get().bulkConnectFrom;
    set({ mode: 'select', connectFrom: null, bulkConnectFrom: null, ...(wasConnecting ? { query: '' } : {}) });
  },

  async connect(sourceId, targetId) {
    if (sourceId === targetId) { get().cancelConnect(); return; }
    const name = (id: string) => get().codes.find((n) => n.id === id)?.name ?? id;
    try {
      const edge = await api.addEdge(sourceId, targetId);
      set((s) => ({ edges: [...s.edges, edge], mode: 'select', connectFrom: null, selectedId: targetId, query: '' }));
      get().notify(`Connected ${name(sourceId)} ⇢ ${name(targetId)}`);
    } catch (err) {
      get().notify(message(err, 'Could not create that edge.'), 'error');
      get().cancelConnect();
    }
  },

  async connectTo(targetId) {
    const { connectFrom, bulkConnectFrom } = get();
    if (bulkConnectFrom) { await get().bulkConnect(bulkConnectFrom, targetId); return; }
    if (!connectFrom) return;
    await get().connect(connectFrom, targetId);
  },

  async bulkConnect(sourceIds, targetId) {
    const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
    if (sources.length === 0) { get().cancelConnect(); return; }
    const name = (id: string) => get().codes.find((n) => n.id === id)?.name ?? id;
    const results = await Promise.allSettled(sources.map((id) => api.addEdge(id, targetId)));
    const created = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.length - created.length;
    set((s) => ({
      edges: [...s.edges, ...created],
      mode: 'select',
      connectFrom: null,
      bulkConnectFrom: null,
      selectedId: targetId,
      selectedIds: new Set(),
      multiAnchorId: null,
      query: '',
    }));
    if (created.length > 0) {
      get().notify(
        `Connected ${created.length} code${created.length === 1 ? '' : 's'} ⇢ ${name(targetId)}${failed ? ` — ${failed} failed` : ''}`,
        failed ? 'error' : 'info',
      );
    } else {
      get().notify('Could not create those edges.', 'error');
    }
  },

  async removeEdge(edgeId) {
    const previous = get().edges;
    set({ edges: previous.filter((e) => e.id !== edgeId) });
    try {
      await api.removeEdge(edgeId);
      get().notify('Edge removed');
    } catch (err) {
      set({ edges: previous });
      get().notify(message(err, 'Could not remove that edge.'), 'error');
    }
  },

  async moveCode(id, x, y) {
    // The drag already moved the code on screen; this only persists where it landed.
    set((s) => ({ codes: s.codes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
    try {
      const saved = await api.updateCode(id, { x, y });
      set((s) => stamp(s, id, saved));
    } catch (err) {
      get().notify(message(err, 'Could not save the new position.'), 'error');
    }
  },

  async duplicate(id, withInputs) {
    try {
      const copy = await api.duplicateCode(id, withInputs);
      await get().load();
      set({ selectedId: copy.id });
      const inherited = get().edges.filter((e) => e.target === copy.id).length;
      get().notify(withInputs ? `Duplicated with ${inherited} upstream edges → ${copy.name}` : `Duplicated → ${copy.name}`);
    } catch (err) {
      get().notify(message(err, 'Could not duplicate that code.'), 'error');
    }
  },

  async addTag(id, tag) {
    try {
      const { tags, ...edited } = await api.addTag(id, tag);
      set((s) => stamp(s, id, edited, { tags }));
      await refreshTagCounts(set);
      get().notify(`Tagged ${get().codes.find((n) => n.id === id)?.name} · ${tag}`);
    } catch (err) {
      get().notify(message(err, 'Could not add that tag.'), 'error');
    }
  },

  async setPrimaryTag(id, tag) {
    try {
      const { tags, ...edited } = await api.setPrimaryTag(id, tag);
      set((s) => stamp(s, id, edited, { tags }));
      get().notify(`${tag} is now the main tag`);
    } catch (err) {
      get().notify(message(err, 'Could not change the main tag.'), 'error');
    }
  },

  async addAssetLink(codeId, input) {
    try {
      const result = await api.addAssetLink(codeId, input);
      await applyAssetLinkResult(get, set, codeId, result);
      get().notify(
        result.edgesCreated > 0
          ? `Added ${input.direction} · ${input.path} — linked ${result.edgesCreated} code${result.edgesCreated === 1 ? '' : 's'} by data flow`
          : `Added ${input.direction} · ${input.path}`,
      );
    } catch (err) {
      get().notify(message(err, 'Could not add that.'), 'error');
    }
  },

  async updateAssetLink(codeId, assetLinkId, patch) {
    try {
      const result = await api.updateAssetLink(assetLinkId, patch);
      await applyAssetLinkResult(get, set, codeId, result);
      get().notify(result.edgesCreated > 0 ? `Saved — linked ${result.edgesCreated} code(s) by data flow` : 'Saved');
    } catch (err) {
      get().notify(message(err, 'Could not save that change.'), 'error');
    }
  },

  async deleteAssetLink(codeId, assetLinkId) {
    try {
      const result = await api.deleteAssetLink(assetLinkId);
      set((s) => ({ codes: s.codes.map((n) => (n.id === codeId ? result.code : n)) }));
      get().notify('Removed');
    } catch (err) {
      get().notify(message(err, 'Could not remove that.'), 'error');
    }
  },

  async relink() {
    try {
      const { edgesCreated } = await api.relink(get().activePipeline);
      if (edgesCreated > 0) await get().load();
      get().notify(
        edgesCreated > 0
          ? `Drew ${edgesCreated} link${edgesCreated === 1 ? '' : 's'} from declared inputs and outputs`
          : 'Every declared input and output is already linked',
      );
    } catch (err) {
      get().notify(message(err, 'Could not rebuild links.'), 'error');
    }
  },

  async removeTag(id, tag) {
    try {
      const { tags, ...edited } = await api.removeTag(id, tag);
      set((s) => stamp(s, id, edited, { tags }));
      await refreshTagCounts(set);
    } catch (err) {
      get().notify(message(err, 'Could not remove that tag.'), 'error');
    }
  },

  async saveDescription(id, description) {
    try {
      const saved = await api.updateCode(id, { description });
      set((s) => settle(s, id, saved));
      get().notify('Description saved');
    } catch (err) {
      get().notify(message(err, 'Could not save the description.'), 'error');
    }
  },

  async saveMetadata(id, patch) {
    try {
      const saved = await api.updateCode(id, patch);
      set((s) => settle(s, id, saved));
      get().notify('Metadata saved');
    } catch (err) {
      get().notify(message(err, 'Could not save the metadata.'), 'error');
    }
  },

  async createCode(input) {
    try {
      const code = await api.createCode(get().activePipeline, input);
      await get().load();
      set({ selectedId: code.id });
      get().notify(`Created ${code.name}`);
    } catch (err) {
      get().notify(message(err, 'Could not create that code.'), 'error');
    }
  },

  async deleteCode(id) {
    const name = get().codes.find((n) => n.id === id)?.name ?? id;
    try {
      await api.deleteCode(id);
      set((s) => ({
        codes: s.codes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        tabs: s.tabs.filter((t) => !(t.kind === 'flow' && t.refId === id)),
        activeTab: s.tabs.some((t) => t.id === s.activeTab && t.kind === 'flow' && t.refId === id) ? 'graph' : s.activeTab,
      }));
      await refreshTagCounts(set);
      get().notify(`Deleted ${name}`);
    } catch (err) {
      get().notify(message(err, 'Could not delete that code.'), 'error');
    }
  },

  openFlowTab(codeId) {
    const code = get().codes.find((n) => n.id === codeId);
    if (!code) return;
    const id = `flow:${codeId}`;
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === id)
        ? s.tabs
        : [...s.tabs, { id, kind: 'flow', label: `${code.name} · logic`, color: codeColor(code), refId: codeId }],
      activeTab: id,
    }));
  },

  /**
   * A rename reaches further than the asset's own page: every input and output
   * that named the table now reads differently, and the codes holding them were
   * touched, so the graph and the catalogue are both refetched. The open tab is
   * relabelled here too — its label was baked in when it opened, and nothing
   * else would ever correct it.
   */
  async assetRenamed(assetId, name) {
    const id = `schema:${assetId}`;
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, label: `${name} · schema` } : t)) }));
    await Promise.all([get().load(), get().loadAssets()]);
  },

  openSchemaTab(assetId) {
    const id = `schema:${assetId}`;
    // Ids say nothing about the asset, so the tab is labelled with its real
    // name — found in the catalogue if it is loaded, otherwise on the asset
    // link that points at it.
    const state = get();
    const name =
      state.assets.find((d) => d.id === assetId)?.name ??
      state.codes
        .flatMap((n) => [...n.inputs, ...n.outputs])
        .find((a) => a.assetId === assetId)?.path ??
      assetId;
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === id)
        ? s.tabs
        : [...s.tabs, { id, kind: 'schema', label: `${name} · schema`, color: 'var(--t-sql)', refId: assetId }],
      activeTab: id,
    }));
  },

  closeTab(tabId) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      return { tabs, activeTab: s.activeTab === tabId ? tabs[tabs.length - 1].id : s.activeTab };
    });
  },

  setActiveTab(tabId) { set({ activeTab: tabId }); },
}));

/** Edges inferred server-side are not in the local copy, so refetch when any appeared. */
async function applyAssetLinkResult(
  get: () => AtlasState,
  set: (partial: Partial<AtlasState>) => void,
  codeId: string,
  result: { code: Code; edgesCreated: number },
) {
  if (result.edgesCreated > 0) {
    await get().load();
    return;
  }
  set({ codes: get().codes.map((n) => (n.id === codeId ? result.code : n)) });
}

async function refreshTagCounts(set: (partial: Partial<AtlasState>) => void) {
  const graph = await api.graph(useAtlas.getState().activePipeline);
  set({ tagCounts: graph.tags });
}
