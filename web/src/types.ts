export type CodeStatus = 'active' | 'inactive';

/**
 * Mirrors the server's `Stewardship`: who is answerable for a record, who last
 * touched it, and when. Every code and every asset carries all four.
 *
 * The dates are the **documentation's**, not the pipeline's — when this code or
 * asset was written down, and when what Atlas says about it last changed.
 * Nothing here watches a warehouse, so nothing here is a freshness signal.
 */
export interface Stewardship {
  /** The team or person answerable for the thing itself. */
  owner: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. */
  updatedAt: string;
  /** Who made the last edit. Attribution, not authentication. */
  updatedBy: string;
}

export interface AssetLink {
  id: string;
  direction: 'input' | 'output';
  path: string;
  detail: string;
  /** Ordered; the first is the main tag, shown beside the asset on the code display. */
  tags: string[];
  assetId: string | null;
  position: number;
}

export interface Code extends Stewardship {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
  status: CodeStatus;
  /** Ordered; the first is the primary tag, which colours the code. */
  tags: string[];
  inputs: AssetLink[];
  outputs: AssetLink[];
  assetId: string | null;
  hasFlow: boolean;
  searchTerms: string[];
}

/** Everything `PATCH /api/codes/:id` accepts. Every field is optional and an
 * omitted one is left alone — which is what lets the inspector send only what
 * the user actually changed, so an ordinary edit still auto-stamps the dates
 * while a deliberate edit of them wins. */
export type CodePatch = Partial<
  Pick<Code, 'name' | 'description' | 'owner' | 'status' | 'x' | 'y' | 'createdAt' | 'updatedAt' | 'updatedBy'>
>;

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphPayload {
  codes: Code[];
  edges: GraphEdge[];
  tags: { tag: string; count: number }[];
  pipelineId: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  codeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the server's `ImportResult`. An import reports not just what landed
 * but where it came from, so a pipeline that arrived as a file can still say so
 * afterwards. */
export interface ImportResult {
  pipeline: Pipeline;
  source: {
    formatVersion: number;
    generator: { name: string; version: string };
    exportedAt: string;
  };
  /** One line per format-upgrade step applied on the way in. */
  upgrades: string[];
  /** Non-fatal repairs: skipped cycles, dangling references, and the like. */
  warnings: string[];
}

/** Mirrors the server's `VersionInfo` — `GET /api/version`. */
export interface VersionInfo {
  name: string;
  version: string;
  bundleFormat: string;
  bundleVersion: number;
  minBundleVersion: number;
  node: string;
}

export interface FlowInput {
  steps: { op: string; title: string; body: string }[];
}

export interface AssetLinkInput {
  direction: 'input' | 'output';
  path: string;
  detail: string;
  /** Ordered; the first is the main tag. */
  tags: string[];
  /** True to resolve (or create) a catalogued asset named `path` and link it. */
  documented: boolean;
}

export interface AssetSummary extends Stewardship {
  id: string;
  name: string;
  materialization: string;
  description: string;
  producedBy: { id: string; name: string; tags: string[] } | null;
  columnCount: number;
  consumerCount: number;
  testedColumns: number;
}

export interface AssetSchemaInput {
  materialization: string;
  description: string;
  /** Every optional field is left as it was when omitted. */
  name?: string;
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  columns: {
    name: string;
    dataType: string;
    keyKind: 'pk' | 'fk' | null;
    nullable: boolean;
    description: string;
    tests: string[];
  }[];
}

export interface AssetLinkResult {
  code: Code;
  assetId: string | null;
  edgesCreated: number;
}

export interface FlowStep {
  id: string;
  position: number;
  op: string;
  title: string;
  body: string;
}

export interface CodeFlow {
  codeId: string;
  name: string;
  steps: FlowStep[];
}

export interface AssetColumn {
  id: string;
  name: string;
  dataType: string;
  keyKind: 'pk' | 'fk' | null;
  nullable: boolean;
  description: string;
  tests: string[];
  position: number;
}

export interface CodeRef {
  id: string;
  name: string;
  tags: string[];
}

export interface Asset extends Stewardship {
  id: string;
  name: string;
  codeId: string | null;
  materialization: string;
  description: string;
  columns: AssetColumn[];
  producedBy: CodeRef | null;
  consumedBy: CodeRef[];
  certified: boolean;
  containsPii: boolean;
}

/**
 * Tags people already know from the seeded warehouse keep the colours they
 * always had; anything invented later gets a stable colour from the palette.
 * Stable means: the same tag is always the same colour, in every pipeline and
 * on every machine, without storing anything.
 */
const NAMED_TAG_COLORS: Record<string, string> = {
  source: 'var(--t-source)',
  sql: 'var(--t-sql)',
  python: 'var(--t-code)',
  mart: 'var(--t-mart)',
  test: 'var(--t-check)',
};

const TAG_PALETTE = [
  'var(--tag-1)', 'var(--tag-2)', 'var(--tag-3)', 'var(--tag-4)',
  'var(--tag-5)', 'var(--tag-6)', 'var(--tag-7)', 'var(--tag-8)',
];

export function tagColor(tag: string): string {
  const named = NAMED_TAG_COLORS[tag];
  if (named) return named;
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

/** A code with no tags still has to render, so it falls back to a label. */
export function primaryTag(code: { tags: string[] }): string {
  return code.tags[0] ?? 'untagged';
}

export function codeColor(code: { tags: string[] }): string {
  return tagColor(primaryTag(code));
}

/** An asset link's main tag — shown beside it on the code display. Not every
 * link has one, since tags on a link are optional. */
export function assetLinkTag(link: { tags: string[] }): string | null {
  return link.tags[0] ?? null;
}

export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-.]/g, '');
}

/**
 * A stored timestamp as a person reads it: `9 Sep 2026, 19:08`, in the reader's
 * own timezone and locale. The server sends ISO-8601 with its `Z`, so the
 * conversion is the browser's to make and there is nothing to guess at here.
 * An empty or unparseable value renders as an em dash rather than
 * "Invalid Date".
 */
export function formatStamp(iso: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------ filtering by date */

/** Which of the two stewardship dates a date filter looks at. */
export type DateField = 'createdAt' | 'updatedAt';

/**
 * A window on one of those dates. `from` and `to` are **local calendar days**
 * in `YYYY-MM-DD`, exactly as `<input type="date">` hands them over; either may
 * be empty, meaning unbounded on that side. Both empty is no filter at all.
 *
 * Local days, not instants, because that is the question being asked: "changed
 * on or after the 9th" means the 9th where the reader is sitting, not 00:00 UTC.
 */
export interface DateRange {
  field: DateField;
  from: string;
  to: string;
}

/** No window — the default, and what `reset` goes back to. */
export const ANY_DATE: DateRange = { field: 'updatedAt', from: '', to: '' };

export const isDateFiltered = (range: DateRange): boolean => !!(range.from || range.to);

/** A local calendar day as `YYYY-MM-DD`. Not `toISOString`, which is UTC and
 * would name yesterday for anyone west of Greenwich in the evening. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` shifted by whole days, for the preset windows. */
export function dayOffset(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return localDay(at);
}

/**
 * Whether a record's chosen date falls inside the window. `from` includes the
 * whole of that day and `to` includes the whole of that day, so picking the
 * same date for both means "on that day" rather than an empty instant.
 *
 * A record with no usable date fails any bounded window — it cannot be claimed
 * to fall inside one — and passes when there is no window to fail.
 */
export function withinDates(record: Stewardship, range: DateRange): boolean {
  if (!isDateFiltered(range)) return true;
  const at = Date.parse(record[range.field]);
  if (Number.isNaN(at)) return false;

  const from = range.from ? Date.parse(`${range.from}T00:00:00`) : NaN;
  const to = range.to ? Date.parse(`${range.to}T23:59:59.999`) : NaN;
  // A half-typed date parses as NaN; leave that side unbounded rather than
  // blanking the list under the user mid-keystroke.
  if (!Number.isNaN(from) && at < from) return false;
  if (!Number.isNaN(to) && at > to) return false;
  return true;
}

/**
 * An ISO-8601 instant as `<input type="datetime-local">` wants it:
 * `YYYY-MM-DDTHH:mm`, in the reader's own timezone. Empty for anything
 * unparseable, which leaves the input blank rather than rejecting a keystroke.
 */
export function toLocalInput(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * The way back: a local `YYYY-MM-DDTHH:mm` to the ISO-8601 UTC the API stores.
 * Returns `null` while the value is empty or half-typed, which is the signal
 * to leave that field out of the patch rather than send a broken date.
 */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export const STATUS_COLOR: Record<CodeStatus, string> = {
  active: 'var(--good)',
  inactive: 'var(--ink-3)',
};

/** An asset as the Schema tab draws it (`GET /api/schema`). Identical to
 * `Asset` since sample rows were dropped — kept as a name because the Schema
 * tab's own code reads better for it. */
export type SchemaTable = Asset;
