import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Drizzle 0.45 has no built-in bytea. */
export const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const SECRET_STATES = [
  "pending", // initialized, waiting for the sealed payload
  "sealed", // ciphertext stored, retrievable
  "retrieved", // burned by a successful reveal; row kept for the read receipt
] as const;
export type SecretState = (typeof SECRET_STATES)[number];

export const secrets = pgTable(
  "secrets",
  {
    /** nanoid(21), ~126 bits of randomness — unguessable capability. */
    id: text("id").primaryKey(),
    state: text("state", { enum: SECRET_STATES }).notNull().default("pending"),

    // Sealed payload; all nulled at burn time (data minimization).
    ciphertext: bytea("ciphertext"),
    nonce: bytea("nonce"),
    salt: bytea("salt"),
    publicKey: bytea("public_key"),

    // Single active challenge (seal or reveal), rotated on every handshake.
    challenge: bytea("challenge"),
    challengeExpiresAt: timestamp("challenge_expires_at", {
      withTimezone: true,
    }),

    /** Whether creation came from SAFE_NETWORKS (SAFEGUARDED mode). */
    createdFromSafe: boolean("created_from_safe").notNull().default(false),

    /** The chosen expiry option, echoed to the creator's history UI. */
    expiresIn: text("expires_in").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    /** Hard deadline; every read predicate checks it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("secrets_expires_at_idx").on(table.expiresAt),
    index("secrets_state_idx").on(table.state),
    // Defense-in-depth beside the app-level payload validation.
    check(
      "secrets_ciphertext_size",
      sql`${table.ciphertext} IS NULL OR octet_length(${table.ciphertext}) <= 8192`,
    ),
  ],
);

export type SecretRow = typeof secrets.$inferSelect;

/**
 * Per-(secret, client) retrieval throttle. A wrong retrieval password NEVER
 * destroys a secret; instead failed signature verifications record an
 * exponential backoff keyed by the secret and an HMAC of the client IP (never
 * the raw IP). Because it lives in the database, the backoff is consistent
 * across all app replicas. Scoping to the secret means an attacker can only
 * slow down their own guessing on one secret and can never lock out the
 * legitimate recipient (who retrieves from a different address).
 */
export const retrievalAttempts = pgTable(
  "retrieval_attempts",
  {
    secretId: text("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    /** HMAC-SHA256 of the client IP (hex). Raw IPs are never stored. */
    ipHash: text("ip_hash").notNull(),
    failCount: integer("fail_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.secretId, table.ipHash] }),
    index("retrieval_attempts_locked_until_idx").on(table.lockedUntil),
  ],
);

export type RetrievalAttemptRow = typeof retrievalAttempts.$inferSelect;
