import type { Asset, AssetLinkInput, AssetLinkResult, AssetSchemaInput, AssetSummary, Code, CodeFlow, CodePatch, FlowInput, GraphEdge, GraphPayload, ImportResult, Pipeline, SchemaTable, VersionInfo } from '../types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

const q = (graphId: string) => `?graph=${encodeURIComponent(graphId)}`;

/** A tag write answers with the new tag list and the stewardship it moved. */
type TagResult = { tags: string[] } & Pick<Code, 'updatedAt' | 'updatedBy'>;

export const api = {
  /** What the server is and which file formats it accepts. */
  version: () => request<VersionInfo>('/version'),

  graph: (graphId: string) => request<GraphPayload>(`/graph${q(graphId)}`),

  /* pipelines */
  pipelines: () => request<Pipeline[]>('/pipelines'),

  createPipeline: (name: string, description = '') =>
    request<Pipeline>('/pipelines', { method: 'POST', ...json({ name, description }) }),

  renamePipeline: (id: string, name: string) =>
    request<Pipeline>(`/pipelines/${id}`, { method: 'PATCH', ...json({ name }) }),

  deletePipeline: (id: string) => request<void>(`/pipelines/${id}`, { method: 'DELETE' }),

  /** The browser downloads this URL directly — no fetch, so the filename header applies. */
  exportUrl: (id: string) => `/api/pipelines/${id}/export`,

  /**
   * Takes the file's text, not a parsed bundle. A pipeline export is the one
   * body big enough for it to matter: parsing it here only to re-serialise it
   * for `fetch` would hold the text, the object graph and a second copy of the
   * text in memory at once, and the server has to parse it again regardless.
   */
  importPipeline: (bundleText: string, name?: string) =>
    request<ImportResult>(`/pipelines/import${name ? `?name=${encodeURIComponent(name)}` : ''}`, {
      method: 'POST',
      body: bundleText,
    }),

  createCode: (graphId: string, input: { name: string; tags: string[]; x: number; y: number }) =>
    request<Code>(`/codes${q(graphId)}`, { method: 'POST', ...json(input) }),

  updateCode: (id: string, patch: CodePatch) =>
    request<Code>(`/codes/${id}`, { method: 'PATCH', ...json(patch) }),

  deleteCode: (id: string) => request<void>(`/codes/${id}`, { method: 'DELETE' }),

  duplicateCode: (id: string, withInputs: boolean) =>
    request<Code>(`/codes/${id}/duplicate`, { method: 'POST', ...json({ withInputs }) }),

  addTag: (id: string, tag: string) =>
    request<TagResult>(`/codes/${id}/tags`, { method: 'POST', ...json({ tag }) }),

  removeTag: (id: string, tag: string) =>
    request<TagResult>(`/codes/${id}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),

  setPrimaryTag: (id: string, tag: string) =>
    request<TagResult>(`/codes/${id}/tags/${encodeURIComponent(tag)}/primary`, { method: 'POST' }),

  flow: (id: string) => request<CodeFlow>(`/codes/${id}/flow`),

  saveFlow: (id: string, input: FlowInput) =>
    request<CodeFlow>(`/codes/${id}/flow`, { method: 'PUT', ...json(input) }),

  linkableAssets: (id: string) => request<{ id: string; name: string }[]>(`/codes/${id}/linkable-assets`),

  addAssetLink: (codeId: string, input: AssetLinkInput) =>
    request<AssetLinkResult>(`/codes/${codeId}/asset-links`, { method: 'POST', ...json(input) }),

  updateAssetLink: (assetLinkId: string, patch: Partial<AssetLinkInput>) =>
    request<AssetLinkResult>(`/asset-links/${assetLinkId}`, { method: 'PATCH', ...json(patch) }),

  deleteAssetLink: (assetLinkId: string) =>
    request<AssetLinkResult>(`/asset-links/${assetLinkId}`, { method: 'DELETE' }),

  assets: (graphId: string) => request<AssetSummary[]>(`/assets${q(graphId)}`),

  /** Every table in the pipeline with its columns — what the Schema tab draws. */
  schema: (graphId: string) => request<SchemaTable[]>(`/schema${q(graphId)}`),

  createAsset: (graphId: string, input: { name: string; materialization?: string; producerCodeId?: string | null }) =>
    request<AssetSummary>(`/assets${q(graphId)}`, { method: 'POST', ...json(input) }),

  deleteAsset: (assetId: string) =>
    request<void>(`/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),

  saveSchema: (assetId: string, input: AssetSchemaInput) =>
    request<Asset>(`/assets/${encodeURIComponent(assetId)}/schema`, { method: 'PUT', ...json(input) }),

  relink: (graphId: string) =>
    request<{ edgesCreated: number }>(`/pipelines/${graphId}/relink`, { method: 'POST' }),

  addEdge: (source: string, target: string) =>
    request<GraphEdge>('/edges', { method: 'POST', ...json({ source, target }) }),

  removeEdge: (id: string) => request<void>(`/edges/${id}`, { method: 'DELETE' }),

  asset: (id: string) => request<Asset>(`/assets/${encodeURIComponent(id)}`),
};
