import { drizzle } from "drizzle-orm/node-postgres";
import { withReplicas } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import { getConfig } from "../config";
import * as schema from "./schema";

/**
 * Database access. The primary handles all writes and consistency-critical
 * reads (via db.$primary); optional read replicas (DATABASE_REPLICA_URLS)
 * serve the remaining SELECTs through drizzle's withReplicas.
 *
 * Pools are lazily created on first use and cached on globalThis so dev-mode
 * hot reloading does not leak connections.
 */

type Db = ReturnType<typeof createDb>;

function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

function createDb() {
  const config = getConfig();
  const primaryPool = createPool(config.databaseUrl);
  const primary = drizzle(primaryPool, { schema });

  if (config.databaseReplicaUrls.length === 0) {
    // withReplicas with the primary as sole "replica" keeps one code path
    // (db.$primary is always available).
    return { db: withReplicas(primary, [primary]), pools: [primaryPool] };
  }

  const replicaPools = config.databaseReplicaUrls.map(createPool);
  const [firstReplica, ...restReplicas] = replicaPools.map((pool) =>
    drizzle(pool, { schema }),
  );
  return {
    db: withReplicas(primary, [firstReplica!, ...restReplicas]),
    pools: [primaryPool, ...replicaPools],
  };
}

const globalCache = globalThis as unknown as { __1xsecretDb?: Db };

export function getDb() {
  globalCache.__1xsecretDb ??= createDb();
  return globalCache.__1xsecretDb.db;
}

export { schema };
