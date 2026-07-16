# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** via
[GitHub private vulnerability reporting](https://github.com/1xSecret/1xSecret/security/advisories/new)
("Security" tab → "Report a vulnerability").

- Do **not** open public issues or pull requests for security problems.
- Include reproduction steps and the affected version/commit if possible.
- We will acknowledge the report, work on a fix, and coordinate disclosure through a
  GitHub security advisory.

## Scope

1xSecret's security promises (what the server can and cannot see, one-time semantics,
the password factor, the client-IP trust model) are specified in
[docs/SECURITY.md](./docs/SECURITY.md). Anything that breaks a promise made there is in
scope — including flaws in the cryptographic scheme, the atomic burn, challenge
handling, and IP/CIDR enforcement.

## Supported versions

Security fixes target the latest release (`ghcr.io/1xsecret/1xsecret`). Older tags do
not receive backports.
