export {
  OneXSecretClient,
  type OneXSecretClientOptions,
  type SealOptions,
  type SealResult,
  type RevealOptions,
  type ExpiresIn,
} from "./client.js";

export {
  OneXSecretError,
  SecretUnavailableError,
  WrongPasswordError,
  RetrievalThrottledError,
  RetrievalRestrictedError,
  CreationRestrictedError,
  InvalidLinkError,
  ApiRequestError,
} from "./errors.js";

export { MAX_SECRET_LENGTH } from "./crypto.js";
