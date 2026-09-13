import type { CodeStatus } from './types.js';

/** `kind` is seed-authoring shorthand only: 'dataset' becomes a documented
 * asset link, anything else becomes that word as the link's one tag. */
type AssetLinkSeed = [kind: 'dataset' | 'file' | 'seed' | 'doc' | 'connector', path: string, detail: string];

export interface CodeSeed {
  id: string;
  name: string;
  /** Seeded as the code's primary tag — there is no separate type any more. */
  type: string;
  x: number;
  y: number;
  tags: string[];
  status: CodeStatus;
  description: string;
  owner: string;
  inputs: AssetLinkSeed[];
  outputs: AssetLinkSeed[];
}

export const CODES: CodeSeed[] = [
  {
    id: 'raw_shopify_orders', name: 'raw.shopify_orders', type: 'source', x: 40, y: 70,
    tags: ['source', 'shopify', 'pii'], status: 'active',
    description: 'Raw order payload landed by Fivetran every 15 minutes. Nested customer JSON is flattened downstream, never here.',
    owner: 'Data Platform',
    inputs: [['connector', 'ingest/fivetran/shopify.yml', 'sync every 15 min']],
    outputs: [['dataset', 'raw.shopify_orders', 'table · 8.42 M rows'], ['doc', 'docs/sources/shopify.md', 'source contract']],
  },
  {
    id: 'raw_stripe_charges', name: 'raw.stripe_charges', type: 'source', x: 40, y: 250,
    tags: ['source', 'stripe', 'finance'], status: 'active',
    description: 'Charge, refund and dispute events from the Stripe API. Append-only; late-arriving refunds are common.',
    owner: 'Data Platform',
    inputs: [['connector', 'ingest/fivetran/stripe.yml', 'sync every 15 min']],
    outputs: [['dataset', 'raw.stripe_charges', 'table · 12.9 M rows']],
  },
  {
    id: 'raw_crm_accounts', name: 'raw.crm_accounts', type: 'source', x: 40, y: 430,
    tags: ['source', 'crm', 'pii'], status: 'inactive',
    description: 'Daily snapshot of the Salesforce account object. Snapshot, not history — yesterday’s values are overwritten.',
    owner: 'RevOps',
    inputs: [['connector', 'ingest/fivetran/salesforce.yml', 'daily 02:00 UTC']],
    outputs: [['dataset', 'raw.crm_accounts', 'table · 41.3 K rows']],
  },
  {
    id: 'raw_web_events', name: 'raw.web_events', type: 'source', x: 40, y: 610,
    tags: ['source', 'product'], status: 'active',
    description: 'Clickstream events from the Segment pipeline, partitioned by event date.',
    owner: 'Growth Eng',
    inputs: [['connector', 'ingest/segment/web.yml', 'streaming']],
    outputs: [['dataset', 'raw.web_events', 'partitioned table · 1.24 B rows']],
  },

  {
    id: 'stg_orders', name: 'stg_orders', type: 'sql', x: 300, y: 70,
    tags: ['staging', 'orders', 'pii'], status: 'active',
    description: 'Types the raw Shopify payload, converts timestamps to UTC and deduplicates on order id, keeping the latest version.',
    owner: 'Analytics Eng',
    inputs: [['dataset', 'raw.shopify_orders', 'source table'], ['file', 'models/staging/stg_orders.sql', '132 lines'], ['seed', 'seeds/order_status_map.csv', '14 rows']],
    outputs: [['dataset', 'analytics.stg_orders', 'view'], ['doc', 'docs/models/stg_orders.md', 'model doc']],
  },
  {
    id: 'stg_payments', name: 'stg_payments', type: 'sql', x: 300, y: 250,
    tags: ['staging', 'finance'], status: 'active',
    description: 'One row per Stripe charge with refunds attached and a boolean is_settled flag replacing the raw status enum.',
    owner: 'Analytics Eng',
    inputs: [['dataset', 'raw.stripe_charges', 'source table'], ['file', 'models/staging/stg_payments.sql', '98 lines']],
    outputs: [['dataset', 'analytics.stg_payments', 'view']],
  },
  {
    id: 'stg_accounts', name: 'stg_accounts', type: 'sql', x: 300, y: 430,
    tags: ['staging', 'crm', 'pii'], status: 'inactive',
    description: 'Cleans account names, standardises region codes and drops the 40+ unused Salesforce custom fields.',
    owner: 'Analytics Eng',
    inputs: [['dataset', 'raw.crm_accounts', 'source table'], ['file', 'models/staging/stg_accounts.sql', '76 lines']],
    outputs: [['dataset', 'analytics.stg_accounts', 'view']],
  },
  {
    id: 'stg_sessions', name: 'stg_sessions', type: 'sql', x: 300, y: 610,
    tags: ['staging', 'product'], status: 'active',
    description: 'Sessionises raw web events with a 30-minute inactivity window and attaches the resolved account id.',
    owner: 'Growth Analytics',
    inputs: [['dataset', 'raw.web_events', 'source table'], ['file', 'models/staging/stg_sessions.sql', '204 lines']],
    outputs: [['dataset', 'analytics.stg_sessions', 'incremental table']],
  },

  {
    id: 'int_order_payments', name: 'int_order_payments', type: 'sql', x: 560, y: 130,
    tags: ['intermediate', 'finance', 'orders'], status: 'active',
    description: 'Joins orders to settled payments, converts every amount to USD at the daily rate, and derives settlement lag.',
    owner: 'Analytics Eng',
    inputs: [['dataset', 'analytics.stg_orders', '8.41 M rows'], ['dataset', 'analytics.stg_payments', '12.8 M rows'], ['file', 'models/intermediate/int_order_payments.sql', '142 lines'], ['seed', 'seeds/seed_fx_daily.csv', '2,190 rows']],
    outputs: [['dataset', 'analytics.int_order_payments', 'table'], ['doc', 'docs/models/int_order_payments.md', 'model doc']],
  },
  {
    id: 'int_account_health', name: 'int_account_health', type: 'sql', x: 560, y: 450,
    tags: ['intermediate', 'crm', 'product'], status: 'inactive',
    description: 'Composite 0–100 health score built from session recency, support load and order cadence. Weights live in the seed.',
    owner: 'RevOps Analytics',
    inputs: [['dataset', 'analytics.stg_accounts', '41.1 K rows'], ['dataset', 'analytics.stg_sessions', '96.4 M rows'], ['file', 'models/intermediate/int_account_health.sql', '188 lines'], ['seed', 'seeds/health_weights.csv', '9 rows']],
    outputs: [['dataset', 'analytics.int_account_health', 'table']],
  },
  {
    id: 'qc_order_freshness', name: 'qc_order_freshness', type: 'check', x: 560, y: 640,
    tags: ['quality', 'orders'], status: 'inactive',
    description: 'Fails when the newest staged order is more than 45 minutes old. Currently failing — the 02:00 backfill is still running.',
    owner: 'Data Platform',
    inputs: [['dataset', 'analytics.stg_orders', 'freshness probe'], ['file', 'tests/qc_order_freshness.sql', '22 lines']],
    outputs: [['doc', 'docs/tests/qc_order_freshness.md', 'runbook']],
  },

  {
    id: 'fct_orders', name: 'fct_orders', type: 'mart', x: 830, y: 90,
    tags: ['mart', 'orders', 'certified'], status: 'active',
    description: 'Certified order fact at one row per order. This is the table finance reconciles against — schema changes need review.',
    owner: 'Analytics Eng',
    inputs: [['dataset', 'analytics.int_order_payments', '8.39 M rows'], ['file', 'models/marts/fct_orders.sql', '96 lines']],
    outputs: [['dataset', 'analytics.fct_orders', 'table · certified'], ['doc', 'docs/marts/fct_orders.md', 'certified doc']],
  },
  {
    id: 'dim_customer', name: 'dim_customer', type: 'mart', x: 830, y: 300,
    tags: ['mart', 'crm', 'certified', 'pii'], status: 'inactive',
    description: 'Certified account dimension. Carries the health score and lifetime order aggregates alongside CRM attributes.',
    owner: 'RevOps Analytics',
    inputs: [['dataset', 'analytics.int_account_health', '41.1 K rows'], ['dataset', 'analytics.stg_accounts', '41.1 K rows'], ['file', 'models/marts/dim_customer.sql', '118 lines']],
    outputs: [['dataset', 'analytics.dim_customer', 'table · certified'], ['doc', 'docs/marts/dim_customer.md', 'certified doc']],
  },
  {
    id: 'fct_revenue_daily', name: 'fct_revenue_daily', type: 'mart', x: 830, y: 510,
    tags: ['mart', 'finance', 'certified'], status: 'active',
    description: 'Revenue rolled to day × region × segment. Rebuilt in full nightly; the trailing 3 days are refreshed hourly.',
    owner: 'Finance Analytics',
    inputs: [['dataset', 'analytics.int_order_payments', '8.39 M rows'], ['file', 'models/marts/fct_revenue_daily.sql', '88 lines']],
    outputs: [['dataset', 'analytics.fct_revenue_daily', 'table · certified']],
  },
  {
    id: 'customer_churn_score', name: 'customer_churn_score', type: 'code', x: 830, y: 690,
    tags: ['ml', 'crm', 'python'], status: 'active',
    description: 'Nightly gradient-boosted churn score, banded into low / watch / high for the CS team. Model pinned at v4.2.0.',
    owner: 'Data Science',
    inputs: [['dataset', 'analytics.int_account_health', '41.1 K rows'], ['dataset', 'analytics.int_order_payments', '8.39 M rows'], ['file', 'jobs/customer_churn_score.py', '214 lines'], ['file', 'models/churn/gbm@4.2.0.pkl', 'registry artefact']],
    outputs: [['dataset', 'analytics.customer_churn_score', 'table'], ['doc', 'docs/ml/churn_model_card.md', 'model card']],
  },

  {
    id: 'exec_revenue_dash', name: 'exec_revenue_dash', type: 'mart', x: 1110, y: 170,
    tags: ['dashboard', 'finance', 'exec'], status: 'active',
    description: 'Executive revenue dashboard. Five tiles, all sourced from certified marts — no ad-hoc SQL is allowed in this workbook.',
    owner: 'Finance Analytics',
    inputs: [['dataset', 'analytics.fct_revenue_daily', '184 K rows'], ['dataset', 'analytics.fct_orders', '8.39 M rows']],
    outputs: [['doc', 'dashboards/exec_revenue.looker', '5 tiles'], ['doc', 'docs/dashboards/exec_revenue.md', 'tile dictionary']],
  },
  {
    id: 'finance_recon_book', name: 'finance_recon_book', type: 'mart', x: 1110, y: 380,
    tags: ['export', 'finance', 'audit'], status: 'active',
    description: 'Month-end reconciliation workbook handed to the controller. Row counts are tied out against Stripe payouts.',
    owner: 'Finance Ops',
    inputs: [['dataset', 'analytics.fct_orders', '8.39 M rows'], ['dataset', 'analytics.dim_customer', '41.1 K rows']],
    outputs: [['doc', 'exports/finance_recon_2026_08.xlsx', '4 sheets']],
  },
  {
    id: 'churn_risk_export', name: 'churn_risk_export', type: 'mart', x: 1110, y: 590,
    tags: ['export', 'crm', 'ml'], status: 'active',
    description: 'Reverse-ETL push of high and watch-band accounts into Salesforce, refreshed each morning before the CS standup.',
    owner: 'RevOps',
    inputs: [['dataset', 'analytics.customer_churn_score', '41.1 K rows'], ['dataset', 'analytics.dim_customer', '41.1 K rows']],
    outputs: [['doc', 'reverse_etl/salesforce_churn.yml', 'hightouch sync']],
  },
];

export const EDGES: [string, string][] = [
  ['raw_shopify_orders', 'stg_orders'],
  ['raw_stripe_charges', 'stg_payments'],
  ['raw_crm_accounts', 'stg_accounts'],
  ['raw_web_events', 'stg_sessions'],
  ['stg_orders', 'int_order_payments'],
  ['stg_payments', 'int_order_payments'],
  ['stg_accounts', 'int_account_health'],
  ['stg_sessions', 'int_account_health'],
  ['stg_orders', 'qc_order_freshness'],
  ['int_order_payments', 'qc_order_freshness'],
  ['int_order_payments', 'fct_orders'],
  ['int_order_payments', 'fct_revenue_daily'],
  ['int_account_health', 'dim_customer'],
  ['stg_accounts', 'dim_customer'],
  ['int_account_health', 'customer_churn_score'],
  ['int_order_payments', 'customer_churn_score'],
  ['fct_revenue_daily', 'exec_revenue_dash'],
  ['fct_orders', 'exec_revenue_dash'],
  ['fct_orders', 'finance_recon_book'],
  ['dim_customer', 'finance_recon_book'],
  ['customer_churn_score', 'churn_risk_export'],
  ['dim_customer', 'churn_risk_export'],
];

type ColumnSeed = [name: string, dataType: string, key: '' | 'pk' | 'fk' | 'null', description: string, tests: string];

export const ASSET_DOCS: Record<string, { materialization: string; columns: ColumnSeed[] }> = {
  'raw.shopify_orders': {
    materialization: 'landed table',
    columns: [
      ['id', 'number', 'pk', 'Shopify internal id', ''],
      ['created_at', 'varchar', '', 'ISO-8601 string as delivered by the API', ''],
      ['financial_status', 'varchar', '', 'Raw Shopify enum, un-normalised', ''],
      ['total_price', 'varchar', '', 'Numeric held as string in the source payload', ''],
      ['customer', 'variant', 'null', 'Nested JSON blob — flattened in staging', ''],
    ],
  },
  'analytics.stg_orders': {
    materialization: 'view',
    columns: [
      ['order_id', 'varchar', 'pk', 'Shopify order id, deduplicated on ingest', 'not_null, unique'],
      ['account_id', 'varchar', 'fk', 'FK to stg_accounts.account_id', 'relationships'],
      ['ordered_at', 'timestamp_ntz', '', 'Order placed time, converted to UTC', 'not_null'],
      ['status', 'varchar', '', 'placed / paid / refunded / cancelled', 'accepted_values'],
      ['currency', 'char(3)', '', 'ISO-4217 code as sent by Shopify', 'accepted_values'],
      ['gross_amount', 'number(18,4)', '', 'Line total before discount, order currency', ''],
      ['discount_amount', 'number(18,4)', '', 'Sum of all applied discount codes', ''],
      ['_loaded_at', 'timestamp_ntz', '', 'Warehouse load timestamp, set by the loader', 'not_null'],
    ],
  },
  'analytics.int_order_payments': {
    materialization: 'table',
    columns: [
      ['order_id', 'varchar', 'pk', 'Grain of the model — one row per order', 'not_null, unique'],
      ['account_id', 'varchar', 'fk', 'Owning account', 'not_null'],
      ['ordered_at', 'timestamp_ntz', '', 'Carried from stg_orders', 'not_null'],
      ['payment_count', 'number(9,0)', '', 'Number of settled Stripe charges', ''],
      ['amount_paid_usd', 'number(18,4)', '', 'Charges converted at the daily FX rate', ''],
      ['amount_refunded_usd', 'number(18,4)', '', 'Refunds netted out of paid amount', ''],
      ['first_payment_at', 'timestamp_ntz', 'null', 'Null while an order is still unpaid', ''],
      ['settlement_lag_hours', 'number(9,2)', 'null', 'ordered_at → first_payment_at, in hours', ''],
    ],
  },
  'analytics.dim_customer': {
    materialization: 'table',
    columns: [
      ['account_id', 'varchar', 'pk', 'Surrogate-free natural key from the CRM', 'not_null, unique'],
      ['account_name', 'varchar', '', 'Legal name, trimmed and title-cased', 'not_null'],
      ['segment', 'varchar', '', 'smb / mid_market / enterprise', 'accepted_values'],
      ['region', 'varchar', '', 'Sales region as of the current CRM snapshot', ''],
      ['health_score', 'number(5,2)', 'null', '0–100, from int_account_health', ''],
      ['lifetime_orders', 'number(9,0)', '', 'Count of paid orders, all time', ''],
      ['lifetime_revenue_usd', 'number(18,4)', '', 'Net of refunds', ''],
      ['first_order_at', 'timestamp_ntz', 'null', 'Null for accounts that never ordered', ''],
      ['is_active', 'boolean', '', 'Ordered in the trailing 90 days', 'not_null'],
    ],
  },
  'analytics.fct_orders': {
    materialization: 'table',
    columns: [
      ['order_id', 'varchar', 'pk', 'One row per order', 'not_null, unique'],
      ['account_id', 'varchar', 'fk', 'Joins dim_customer', 'relationships'],
      ['order_date', 'date', '', 'Date key in warehouse timezone', 'not_null'],
      ['status', 'varchar', '', 'Terminal status at snapshot time', 'accepted_values'],
      ['net_revenue_usd', 'number(18,4)', '', 'Paid minus refunded, USD', ''],
      ['settlement_lag_hours', 'number(9,2)', 'null', 'From int_order_payments', ''],
    ],
  },
};
