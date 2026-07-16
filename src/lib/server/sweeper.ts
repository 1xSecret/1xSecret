import { Client } from "pg";

import { getConfig } from "./config";
import { sweepSecrets } from "./secrets";

/**
 * Periodic garbage collection, started once per server process from
 * instrumentation.ts. A Postgres advisory lock (non-blocking) ensures only one
 * replica sweeps at a time; the others skip the round.
 *
 * Advisory lock ids used by 1xSecret (document to avoid collisions when
 * sharing a database): 745839201701 = migrations, 745839201702 = sweeper.
 */
export const SWEEPER_LOCK_ID = "745839201702";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 30 * 1000;

let started = false;

export function startSweeper(): void {
  if (started) return;
  started = true;

  const timeout = setTimeout(() => {
    void sweepOnce();
    const interval = setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS);
    interval.unref();
  }, FIRST_SWEEP_DELAY_MS);
  timeout.unref();
}

export async function sweepOnce(): Promise<void> {
  // Session-level advisory locks must live on one dedicated connection; the
  // sweep statements themselves run through the normal pool. Ending the
  // client releases the lock even if this process dies mid-sweep.
  const client = new Client({
    connectionString: getConfig().databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [SWEEPER_LOCK_ID],
    );
    if (!result.rows[0]?.locked) {
      return; // another replica is sweeping
    }
    await sweepSecrets();
  } catch (error) {
    console.error("[1xsecret] sweep failed:", error);
  } finally {
    await client.end().catch(() => {});
  }
}
