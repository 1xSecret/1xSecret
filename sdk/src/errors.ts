/** Base class for all errors thrown by the SDK. */
export class OneXSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The secret does not exist, has expired, or was already retrieved. */
export class SecretUnavailableError extends OneXSecretError {
  constructor() {
    super("This secret does not exist, has expired, or was already retrieved.");
  }
}

/** Wrong retrieval password (or a corrupted link). The secret was NOT consumed. */
export class WrongPasswordError extends OneXSecretError {
  /** Seconds to wait before the next attempt, if the server applied a lockout. */
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null) {
    super(
      retryAfterSeconds
        ? `Wrong password. The secret is safe; wait ${retryAfterSeconds}s before retrying.`
        : "Wrong password. The secret is safe — you can try again.",
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Too many attempts from this network; retrieval is temporarily throttled. */
export class RetrievalThrottledError extends OneXSecretError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(
      `Too many attempts from this network. Wait about ${retryAfterSeconds}s and try again.`,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Retrieval is not allowed from this network (SAFEGUARDED instances). */
export class RetrievalRestrictedError extends OneXSecretError {
  constructor() {
    super("This secret can only be retrieved from an allowed network.");
  }
}

/** The share link is missing or malformed (no valid key fragment). */
export class InvalidLinkError extends OneXSecretError {
  constructor(message = "The link is missing or malformed.") {
    super(message);
  }
}

/** The instance forbids creation from this network (SAFEGUARDED). */
export class CreationRestrictedError extends OneXSecretError {
  constructor() {
    super("This instance does not allow creating secrets from this network.");
  }
}

/** The server rejected the request (rate limit, validation, or server error). */
export class ApiRequestError extends OneXSecretError {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
