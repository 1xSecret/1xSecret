# @1xsecret/sdk

Client SDK for [1xSecret](https://github.com/1xSecret/1xSecret) — seal and reveal
**one-time, end-to-end-encrypted secrets** from a Node.js backend (or any WebCrypto
runtime). All encryption and decryption happen locally; the server only ever sees
ciphertext, and each secret can be viewed exactly once.

- **Permissively licensed (MIT)** — use it in any project, **including closed-source
  and commercial** ones. (The 1xSecret server is AGPL-3.0; this client SDK is a separate,
  MIT-licensed package.)
- Byte-for-byte compatible with the 1xSecret web app: a secret sealed with the SDK opens
  in the browser and vice versa.
- Points at the public instance `https://1xsecret.com` by default; set `apiUrl` to your
  own self-hosted deployment.

## Install

```sh
npm install @1xsecret/sdk
```

Requires Node.js ≥ 20 (for global `crypto` and `fetch`), or any runtime with WebCrypto.

## Usage

```ts
import { OneXSecretClient } from "@1xsecret/sdk";

const client = new OneXSecretClient({
  // apiUrl: "https://secrets.your-company.com", // defaults to https://1xsecret.com
});

// Seal a secret and get a one-time link.
const { link } = await client.seal({
  text: "client_secret=abc123",
  password: "shared-out-of-band", // optional but recommended
  expiresIn: "1d", // "10m" | "1h" | "1d" | "7d" | "30d"
});
console.log(link);
// https://1xsecret.com/en/s/<id>#v1.<key>[.pw]
//   ^ the part after "#" is the decryption key; it never reaches the server.

// Reveal (and burn) a secret.
const secret = await client.reveal({
  link,
  password: "shared-out-of-band",
});
console.log(secret); // "client_secret=abc123"
```

You can also reveal from an id + fragment instead of a full link:

```ts
await client.reveal({ id, fragment: "v1.<key>.pw", password });
```

## How it works

The SDK generates a random 256-bit key per secret, optionally stretches your password
with Argon2id, derives an AES-256-GCM key and an Ed25519 keypair via HKDF, encrypts the
text locally, and uploads only the ciphertext plus a public key. The decryption key lives
in the URL fragment (`#…`), which browsers and this SDK never send to the server. On
retrieval the SDK proves possession with an Ed25519 signature over a fresh server
challenge; the server hands over the ciphertext and destroys it in the same step.

See the [security whitepaper](https://github.com/1xSecret/1xSecret/blob/main/docs/SECURITY.md)
for the full scheme.

## Errors

`reveal()` and `seal()` throw typed errors you can branch on:

| Error                     | When                                                        |
| ------------------------- | ---------------------------------------------------------- |
| `WrongPasswordError`      | Wrong password (the secret is **not** consumed). Has `retryAfterSeconds` if the server started throttling. |
| `RetrievalThrottledError` | Too many attempts from this network; has `retryAfterSeconds`. |
| `SecretUnavailableError`  | Missing, expired, or already retrieved.                    |
| `RetrievalRestrictedError`| A SAFEGUARDED instance forbids retrieval from this network. |
| `CreationRestrictedError` | A SAFEGUARDED instance forbids creation from this network. |
| `InvalidLinkError`        | The link/fragment is missing or malformed.                 |
| `ApiRequestError`         | Other HTTP/validation errors (`status`, `code`).           |

```ts
import { WrongPasswordError } from "@1xsecret/sdk";

try {
  await client.reveal({ link, password });
} catch (err) {
  if (err instanceof WrongPasswordError) {
    // safe to prompt again — the secret was not consumed
  }
}
```

## API

- `new OneXSecretClient({ apiUrl?, fetch?, basePath? })`
- `client.seal({ text, password?, expiresIn?, locale? }) → { id, link, fragment, restrictedRetrieval }`
- `client.reveal({ link } | { id, fragment }, password?) → string`

## Versioning & compatibility

The SDK is versioned independently of the server — it changes far less often. Its
**major** version tracks the 1xSecret server: a breaking API or crypto-scheme change
(e.g. a new `1xsecret/vN` scheme) bumps both to the next major. Within a major, any SDK
version works against any server of the same major, so `@1xsecret/sdk@1.x` talks to any
1xSecret `1.x` server. Minor and patch releases are independent.

## License

MIT © 1xSecret contributors.
