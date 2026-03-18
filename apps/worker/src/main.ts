import { Pool } from 'pg';
import { Worker } from 'bullmq';

type JobResult = {
  name: string;
  affectedRows: number;
  tookMs: number;
};

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://ecom_user:ecom_pass@localhost:5433/ecommerce_dev';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const apiBaseUrl = process.env.WORKER_API_BASE_URL ?? 'http://localhost:4000';
const workerJobToken = process.env.WORKER_JOB_TOKEN ?? 'dev-worker-token';
const workerIntervalSeconds = parseNumberEnv('WORKER_INTERVAL_SECONDS', 60, 5);
const abandonCartAfterMinutes = parseNumberEnv('WORKER_ABANDON_CART_AFTER_MINUTES', 120, 5);
const cancelPendingOrderAfterMinutes = parseNumberEnv('WORKER_CANCEL_PENDING_ORDER_AFTER_MINUTES', 90, 5);
const queueEnabled = parseBooleanEnv('WORKER_QUEUE_ENABLED', true);
const queueConcurrency = parseNumberEnv('WORKER_QUEUE_CONCURRENCY', 10, 1);

const billingQueueName = 'billing-jobs';
const notificationsQueueName = 'notifications-jobs';
const billingIssueOrderDocumentJob = 'billing.issue-order-document';
const billingIssueCreditNoteJob = 'billing.issue-credit-note';
const notificationOrderPaidEmailJob = 'notifications.order-paid-email';
const notificationOrderStatusChangedEmailJob = 'notifications.order-status-changed-email';

const pool = new Pool({
  connectionString: databaseUrl,
});

let timer: NodeJS.Timeout | null = null;
let running = false;
let queueConnection: { url: string; maxRetriesPerRequest: null } | null = null;
let billingWorker: Worker | null = null;
let notificationsWorker: Worker | null = null;

async function main() {
  log(`Worker started. interval=${workerIntervalSeconds}s queueEnabled=${queueEnabled}`);
  await runAllJobsSafely();
  await startQueueConsumers();

  timer = setInterval(() => {
    void runAllJobsSafely();
  }, workerIntervalSeconds * 1000);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runAllJobsSafely() {
  if (running) {
    log('Skip cycle: previous cycle still running');
    return;
  }

  running = true;
  const cycleStartedAt = Date.now();

  try {
    const results = await Promise.all([
      markAbandonedCarts(abandonCartAfterMinutes),
      cancelStalePendingOrders(cancelPendingOrderAfterMinutes),
    ]);

    const totalAffected = results.reduce((acc, result) => acc + result.affectedRows, 0);
    const totalMs = Date.now() - cycleStartedAt;
    log(`Cycle done. jobs=${results.length} affected=${totalAffected} took=${totalMs}ms`);

    for (const result of results) {
      log(`  - ${result.name}: affected=${result.affectedRows}, took=${result.tookMs}ms`);
    }
  } catch (error) {
    log(`Cycle failed: ${(error as Error).message}`);
  } finally {
    running = false;
  }
}

async function startQueueConsumers(): Promise<void> {
  if (!queueEnabled) {
    log('Queue consumers disabled by WORKER_QUEUE_ENABLED=false');
    return;
  }

  queueConnection = {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };

  billingWorker = new Worker(
    billingQueueName,
    async (job) => {
      if (job.name === billingIssueOrderDocumentJob) {
        await postInternalJob('/internal/jobs/billing/issue-order-document', job.data);
        return;
      }
      if (job.name === billingIssueCreditNoteJob) {
        await postInternalJob('/internal/jobs/billing/issue-credit-note', job.data);
        return;
      }
      throw new Error(`Unknown billing job: ${job.name}`);
    },
    {
      connection: queueConnection,
      concurrency: queueConcurrency,
    },
  );

  notificationsWorker = new Worker(
    notificationsQueueName,
    async (job) => {
      if (job.name === notificationOrderPaidEmailJob) {
        await postInternalJob('/internal/jobs/notifications/order-paid-email', job.data);
        return;
      }
      if (job.name === notificationOrderStatusChangedEmailJob) {
        await postInternalJob('/internal/jobs/notifications/order-status-changed-email', job.data);
        return;
      }
      throw new Error(`Unknown notifications job: ${job.name}`);
    },
    {
      connection: queueConnection,
      concurrency: queueConcurrency,
    },
  );

  billingWorker.on('completed', (job) => {
    log(`[queue ${billingQueueName}] completed job=${job.name} id=${job.id}`);
  });
  notificationsWorker.on('completed', (job) => {
    log(`[queue ${notificationsQueueName}] completed job=${job.name} id=${job.id}`);
  });
  billingWorker.on('failed', (job, error) => {
    log(`[queue ${billingQueueName}] failed job=${job?.name ?? 'unknown'} id=${job?.id ?? '-'} error=${error.message}`);
  });
  notificationsWorker.on('failed', (job, error) => {
    log(
      `[queue ${notificationsQueueName}] failed job=${job?.name ?? 'unknown'} id=${job?.id ?? '-'} error=${error.message}`,
    );
  });

  await Promise.all([billingWorker.waitUntilReady(), notificationsWorker.waitUntilReady()]);
  log(`Queue consumers ready. redis=${redisUrl} concurrency=${queueConcurrency}`);
}

async function postInternalJob(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-token': workerJobToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP ${response.status} ${path}: ${errorBody.slice(0, 500)}`);
  }
}

async function markAbandonedCarts(thresholdMinutes: number): Promise<JobResult> {
  const startedAt = Date.now();
  const result = await pool.query(
    `
      UPDATE carts
      SET status = 'abandoned',
          "updatedAt" = NOW()
      WHERE status = 'active'
        AND "updatedAt" < NOW() - make_interval(mins => $1::int)
    `,
    [thresholdMinutes],
  );

  return {
    name: 'mark-abandoned-carts',
    affectedRows: result.rowCount ?? 0,
    tookMs: Date.now() - startedAt,
  };
}

async function cancelStalePendingOrders(thresholdMinutes: number): Promise<JobResult> {
  const startedAt = Date.now();
  const result = await pool.query(
    `
      WITH stale_orders AS (
        SELECT id, "lifecycleStatus"
        FROM orders
        WHERE status = 'pending_payment'
          AND "createdAt" < NOW() - make_interval(mins => $1::int)
        FOR UPDATE
      ),
      order_quantities AS (
        SELECT oi."productId", SUM(oi.quantity)::int AS qty
        FROM order_items oi
        JOIN stale_orders so ON so.id = oi."orderId"
        GROUP BY oi."productId"
      ),
      released_stock AS (
        UPDATE products p
        SET "reservedStock" = GREATEST(p."reservedStock" - oq.qty, 0),
            "updatedAt" = NOW()
        FROM order_quantities oq
        WHERE p.id = oq."productId"
        RETURNING p.id
      ),
      updated_orders AS (
        UPDATE orders o
        SET status = 'cancelled',
            "paymentStatus" = 'failed',
            "fulfillmentStatus" = 'failed',
            "lifecycleStatus" = 'cancelled',
            "updatedAt" = NOW()
        FROM stale_orders so
        WHERE o.id = so.id
        RETURNING o.id, so."lifecycleStatus"
      ),
      inserted_history AS (
        INSERT INTO order_status_history (
          id,
          "orderId",
          "previousStatus",
          "nextStatus",
          source,
          note,
          metadata,
          "createdAt"
        )
        SELECT
          gen_random_uuid(),
          uo.id,
          uo."lifecycleStatus",
          'cancelled',
          'worker',
          'Order auto-cancelled due pending payment timeout',
          jsonb_build_object('job', 'cancel-stale-pending-orders'),
          NOW()
        FROM updated_orders uo
        WHERE COALESCE(uo."lifecycleStatus", 'pending') <> 'cancelled'
      )
      SELECT COUNT(*)::int AS affected
      FROM updated_orders
    `,
    [thresholdMinutes],
  );

  return {
    name: 'cancel-stale-pending-orders',
    affectedRows: result.rows?.[0]?.affected ?? 0,
    tookMs: Date.now() - startedAt,
  };
}

async function shutdown() {
  log('Shutdown signal received');

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  await Promise.all([
    billingWorker?.close(),
    notificationsWorker?.close(),
  ]);

  queueConnection = null;

  await pool.end();
  log('Worker stopped');
  process.exit(0);
}

function parseNumberEnv(name: string, fallback: number, min: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return fallback;
}

function log(message: string) {
  console.log(`[worker ${new Date().toISOString()}] ${message}`);
}

void main();
