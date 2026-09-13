type StepSeed = [op: string, title: string, body: string];

export interface FlowSeed {
  steps: StepSeed[];
}

/** The demo warehouse's logic flows: what a handful of codes do, step by step. */
export const FLOWS: Record<string, FlowSeed> = {
  int_order_payments: {
    steps: [
      ['read', 'Read staged orders', 'Pulls every order that has not been cancelled. Cancelled orders never carry payments, so excluding them here keeps the join narrow.'],
      ['read', 'Read settled payments', 'Only settled Stripe charges count. Pending authorisations are deliberately dropped rather than counted as zero.'],
      ['read', 'Load FX rates', 'Daily seed of ISO currency → USD rates, keyed on rate_date.'],
      ['join', 'Left join payments and FX', 'Orders are kept on the left so unpaid orders survive with null payment fields — downstream code relies on that.'],
      ['aggregate', 'Aggregate to order grain', 'Counts charges, sums paid and refunded amounts in USD, and takes the earliest settlement timestamp.'],
      ['derive', 'Derive settlement lag', 'Minutes between order and first payment, expressed in hours as a float for the SLA dashboard.'],
    ],
  },

  customer_churn_score: {
    steps: [
      ['read', 'Read account health', 'Loads int_account_health — one row per account with the composite health score.'],
      ['read', 'Aggregate order behaviour', 'Counts orders in the trailing window and averages settlement lag per account.'],
      ['transform', 'Fill missing behaviour', 'Accounts with no orders get zero rather than null, so the model never sees a gap.'],
      ['model', 'Score with GBM v4.2.0', 'Loads the pinned model from the registry and predicts churn probability.'],
      ['derive', 'Band the probability', 'Cuts the score into low / watch / high — the bands the CS team actually works from.'],
      ['write', 'Write table and model card', 'Persists the scored table and refreshes the model card in the docs bucket.'],
    ],
  },

  stg_orders: {
    steps: [
      ['read', 'Read the raw source', 'Reads the landed Shopify order payload straight from the source table — no filtering yet.'],
      ['dedupe', 'Keep the latest version per order', 'Shopify re-sends an order on every update, so a row_number over id ordered by updated_at picks the current version.'],
      ['cast', 'Type and rename columns', 'Casts the string-typed API fields to real types and lifts account_id out of the nested customer JSON.'],
      ['map', 'Map status to canonical values', 'Joins the seed so downstream models see placed / paid / refunded / cancelled rather than raw Shopify enums.'],
    ],
  },
};
