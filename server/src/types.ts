import { BUNDLE_FORMAT } from './version.js';

export type CodeStatus = 'active' | 'inactive';
export type Direction = 'input' | 'output';

/**
 * Who is answerable for a record, who last touched it, and when — carried
 * identically by every code and every asset, so the two never drift apart.
 *
 * A note on what the dates mean, because the temptation to read them as
 * something else is strong: they date the **documentation**, not the pipeline.
 * `createdAt` is when this code or asset was first written down; `updatedAt`
 * moves when its description, owner, tags, schema or logic flow changes.
 * Neither one observes a warehouse, and neither is a freshness signal — the
 * fields that once claimed to be were deliberately removed in format
 * versions 3 and 4, and these are not their return.
 */
export interface Stewardship {
  /** The team or person answerable for the thing itself. Free text. */
  owner: string;
  /** ISO-8601 UTC. When the record was first documented. */
  createdAt: string;
  /** ISO-8601 UTC. When the record was last edited. */
  updatedAt: string;
  /** Who made that last edit. Attribution, not authentication — see `actor.ts`. */
  updatedBy: string;
}

/**
 * All four are recorded automatically *and* editable by hand, which needs one
 * rule to stay coherent: **an explicit value wins for the write that carries
 * it, and the next ordinary edit resumes stamping.**
 *
 * So backdating a record to when it was really written works, and it survives
 * exactly as long as nobody edits the record again — at which point
 * `updatedAt` is once more the truth about the documentation, which is the
 * only thing it can honestly be. It behaves like a file's mtime: `touch -t`
 * sets it, writing to the file moves it back to now.
 */
export interface StewardshipPatch {
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AssetLink {
  id: string;
  direction: Direction;
  path: string;
  detail: string;
  /** Ordered; the first is the main tag, shown beside the asset on the code display. */
  tags: string[];
  /** Set when this asset link points at a catalogued asset whose schema is documented. */
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
  /** Asset this code produces, if it publishes a documented one. */
  assetId: string | null;
  hasFlow: boolean;
  /** Column names folded into search, so a search for a column finds its model. */
  searchTerms: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface Graph {
  codes: Code[];
  edges: GraphEdge[];
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

/** What a client sends to replace a code's logic flow wholesale. */
export interface FlowInput {
  steps: { op: string; title: string; body: string }[];
}

/** A row in the asset catalogue — enough to browse without loading every schema. */
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

/**
 * What the schema editor sends. `materialization`, `description` and `columns`
 * are replaced wholesale; everything optional is left untouched when omitted,
 * so a client that does not offer a field cannot blank it.
 */
export interface AssetSchemaInput extends StewardshipPatch {
  materialization: string;
  description: string;
  /** Renames the asset, and every declared path that pointed at the old name. */
  name?: string;
  columns: {
    name: string;
    dataType: string;
    keyKind: 'pk' | 'fk' | null;
    nullable: boolean;
    description: string;
    tests: string[];
  }[];
}

export interface AssetLinkInput {
  direction: Direction;
  path: string;
  detail: string;
  /** Ordered; the first is the main tag. */
  tags: string[];
  /** True to resolve (or create) a catalogued asset named `path` and link it. */
  documented: boolean;
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

/** An asset as the Schema tab draws it (`GET /api/schema`). Identical to
 * `Asset` since sample rows were dropped — kept as a name because the Schema
 * tab's own code reads better for it. */
export type SchemaTable = Asset;

/* ------------------------------------------------------------- pipelines */

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  codeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------- bundle */

export {
  APP_NAME,
  APP_TITLE,
  APP_VERSION,
  BUNDLE_EXTENSION,
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MIN_BUNDLE_VERSION,
} from './version.js';

/** What wrote a bundle. Present on every file written by 1.0 or later; a file
 * from before that is stamped `unknown` when it is upgraded on the way in. */
export interface BundleGenerator {
  name: string;
  /** Semver of the app that wrote it, or `pre-1.0` for an upgraded older file. */
  version: string;
}

/** Totals as written. Redundant with the arrays on purpose: a human or an agent
 * can read the head of the file and know its size, and the importer can warn
 * when a hand-edited file no longer adds up. */
export interface BundleCounts {
  codes: number;
  edges: number;
  assets: number;
}

/**
 * One pipeline, complete, in a single file. Ids inside a bundle are local to it
 * — the importer remaps them, so the same bundle can be imported repeatedly
 * (and alongside the pipeline it came from) without collisions.
 *
 * The first five fields are the envelope and are stable across versions: any
 * reader can look at `format` and `formatVersion` alone and decide whether it
 * understands the rest. See `docs/FILE_FORMAT.md` for the normative spec.
 */
export interface AtlasBundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  generator: BundleGenerator;
  exportedAt: string;
  counts: BundleCounts;
  pipeline: { name: string; description: string };
  codes: BundleCode[];
  edges: { source: string; target: string }[];
  assets: BundleAsset[];
}

export interface BundleCode extends Stewardship {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
  status: CodeStatus;
  tags: string[];
  steps: { position: number; op: string; title: string; body: string }[];
  assetLinks: {
    direction: Direction;
    path: string;
    detail: string;
    tags: string[];
    /** Local id of an asset in this same bundle, if the link points at one. */
    assetRef: string | null;
    position: number;
  }[];
}

export interface BundleAsset extends Stewardship {
  id: string;
  name: string;
  materialization: string;
  description: string;
  /** Local id of the code that produces it. */
  producedBy: string | null;
  columns: { name: string; dataType: string; keyKind: 'pk' | 'fk' | null; nullable: boolean; description: string; tests: string[]; position: number }[];
}

/* ------------------------------------------------------- reading a bundle */

/** The outcome of reading a file: the bundle as this build understands it,
 * plus everything that happened on the way — which is what the UI and the CLI
 * report, and what makes an import traceable after the fact. */
export interface BundleReadResult {
  bundle: AtlasBundle;
  /** `formatVersion` as found in the file, before any upgrade. */
  sourceVersion: number;
  /** One human-readable line per upgrade step applied. Empty if already current. */
  upgrades: string[];
  /** Non-fatal repairs: the import still lands whole, but something was
   * dropped, skipped or defaulted, and the user is told which. */
  warnings: string[];
  /** Set when the input was a dbt manifest rather than a bundle: one line
   * saying what was read from it. See `dbt.ts`. */
  converted?: string;
}

export interface ImportResult {
  pipeline: Pipeline;
  source: {
    formatVersion: number;
    generator: BundleGenerator;
    exportedAt: string;
  };
  upgrades: string[];
  warnings: string[];
  /** Set when the file was a dbt manifest. */
  converted?: string;
}

/** `GET /api/version` — what a client (or an agent) reads to find out what it
 * is talking to and which files that server will accept. */
export interface VersionInfo {
  name: string;
  version: string;
  bundleFormat: string;
  bundleVersion: number;
  minBundleVersion: number;
  node: string;
}

/* ------------------------------------------------------- legacy bundle v1 */

/** The three-way freshness status codes carried before status was simplified to active/inactive. */
export type LegacyCodeStatus = 'fresh' | 'stale' | 'failing';

/** The shape exported before codes/assets replaced nodes/datasets. */
export interface LegacyBundleV1 {
  format: typeof BUNDLE_FORMAT;
  formatVersion: 1;
  exportedAt: string;
  pipeline: { name: string; description: string };
  nodes: {
    id: string; name: string; x: number; y: number; description: string; owner: string;
    status: LegacyCodeStatus; sla: string; rowCount: string; freshness: string; tags: string[];
    source: { language: 'sql' | 'python'; path: string; code: string } | null;
    steps: { position: number; op: string; title: string; body: string; lineFrom: number; lineTo: number }[];
    artifacts: {
      direction: Direction;
      kind: 'dataset' | 'file' | 'seed' | 'doc' | 'connector';
      path: string;
      detail: string;
      datasetRef: string | null;
      position: number;
    }[];
  }[];
  edges: { source: string; target: string }[];
  datasets: {
    id: string; name: string; materialization: string; description: string; producedBy: string | null;
    columns: { name: string; dataType: string; keyKind: 'pk' | 'fk' | null; nullable: boolean; description: string; tests: string[]; position: number }[];
    sampleRows: string[][];
  }[];
}
