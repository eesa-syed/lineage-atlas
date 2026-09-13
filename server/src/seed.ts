import { nanoid } from 'nanoid';
import { all, DEFAULT_GRAPH_ID, isEmpty, newEntityId, run, tx } from './db.js';
import { CODES, EDGES, ASSET_DOCS } from './seed-data.js';
import { FLOWS } from './seed-flows.js';

const id = () => nanoid(12);

/**
 * The ids in `seed-data.ts` and `seed-flows.ts` — `raw_shopify_orders`, and the
 * dotted asset paths — are authoring handles, there so the demo data can be
 * read and cross-referenced by hand. They are not what lands in the database:
 * every code and asset gets a generated id here, and these maps translate the
 * handles the seed files use into them.
 */

export function seed({ force = false }: { force?: boolean } = {}): boolean {
  if (!force && !isEmpty()) return false;

  tx(() => {
    if (force) {
      // Only the seeded pipeline is reset; imported ones are left alone.
      run('DELETE FROM codes WHERE graph_id = ?', DEFAULT_GRAPH_ID);
      run('DELETE FROM assets WHERE graph_id = ?', DEFAULT_GRAPH_ID);
    }

    /** Seed handle → the code's real id. */
    const codeIds = new Map<string, string>();
    for (const code of CODES) {
      const codeId = newEntityId('codes');
      codeIds.set(code.id, codeId);
      // Seeded records are attributed to the team that owns them rather than
      // to whoever ran the seed: the demo warehouse is meant to read like
      // documentation someone wrote, and "syedeesa" on all eighteen would not.
      // The dates are left to default — they are honestly "when this database
      // was seeded", and inventing a plausible history would be a lie the rest
      // of the seed data does not tell.
      run(
        `INSERT INTO codes (id, graph_id, name, x, y, description, owner, status, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        codeId, DEFAULT_GRAPH_ID, code.name, code.x, code.y, code.description, code.owner, code.status,
        code.owner,
      );
      // The old type leads the tag list, so it stays the code's primary tag.
      const label = code.type === 'code' ? 'python' : code.type === 'check' ? 'test' : code.type;
      [label, ...code.tags].forEach((tag, i) => {
        run('INSERT OR IGNORE INTO code_tags (code_id, tag, position) VALUES (?, ?, ?)', codeId, tag, i);
      });
    }

    // Assets come into existence as the output of a code, so create them from
    // output links first; inputs can then always resolve their link target.
    /** Asset path as the seed writes it → the asset's real id. */
    const assetIds = new Map<string, string>();
    for (const code of CODES) {
      for (const [kind, path, detail] of code.outputs) {
        // The first code to write a path owns it; a second mention is the same asset.
        if (kind !== 'dataset' || assetIds.has(path)) continue;
        const assetId = newEntityId('assets');
        assetIds.set(path, assetId);
        const doc = ASSET_DOCS[path];
        run(
          `INSERT INTO assets (id, graph_id, name, code_id, materialization, description, owner, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          assetId, DEFAULT_GRAPH_ID, path, codeIds.get(code.id)!,
          doc?.materialization ?? detail.split('·')[0].trim() ?? 'table', code.description,
          code.owner, code.owner,
        );
      }
    }

    for (const code of CODES) {
      const write = (direction: 'input' | 'output', list: typeof code.inputs) => {
        list.forEach(([kind, path, detail], i) => {
          // A path nothing writes stays an undocumented link: it points at no asset.
          const assetId = kind === 'dataset' ? assetIds.get(path) ?? null : null;
          const documented = kind === 'dataset';
          const linkId = id();
          run(
            'INSERT INTO asset_links (id, code_id, direction, path, detail, asset_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
            linkId, codeIds.get(code.id)!, direction, path, detail, assetId, i,
          );
          if (!documented) {
            run('INSERT OR IGNORE INTO asset_link_tags (asset_link_id, tag, position) VALUES (?, ?, 0)', linkId, kind);
          }
        });
      };
      write('input', code.inputs);
      write('output', code.outputs);
    }

    for (const [path, doc] of Object.entries(ASSET_DOCS)) {
      const assetId = assetIds.get(path);
      // Documentation for a path no code writes has nothing to hang on.
      if (!assetId) continue;
      doc.columns.forEach(([name, dataType, key, description, tests], i) => {
        run(
          `INSERT INTO asset_columns (id, asset_id, name, data_type, key_kind, nullable, description, tests, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id(), assetId, name, dataType,
          key === 'pk' || key === 'fk' ? key : null,
          key === 'null' ? 1 : 0,
          description, tests, i,
        );
      });
    }

    for (const [source, target] of EDGES) {
      const from = codeIds.get(source);
      const to = codeIds.get(target);
      if (!from || !to) continue;
      run('INSERT OR IGNORE INTO edges (id, source, target) VALUES (?, ?, ?)', id(), from, to);
    }

    for (const [handle, flow] of Object.entries(FLOWS)) {
      const codeId = codeIds.get(handle);
      if (!codeId) continue;
      flow.steps.forEach(([op, title, body], i) => {
        run(
          'INSERT INTO flow_steps (id, code_id, position, op, title, body) VALUES (?, ?, ?, ?, ?, ?)',
          id(), codeId, i, op, title, body,
        );
      });
    }
  });

  return true;
}

// `npm run seed -w server` wipes and reloads the demo warehouse.
if (process.argv.includes('--force')) {
  seed({ force: true });
  console.log(`Seeded ${all<{ id: string }>('SELECT id FROM codes').length} codes.`);
}
