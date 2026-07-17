# Security policy

## Supported versions

Security fixes are made on the latest release line.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability. Use the
repository’s private vulnerability-reporting feature in the GitHub Security tab.
If private reporting is not enabled on the mirror you are using, contact a listed
maintainer privately before disclosing details.

Include a clear reproduction, affected version or commit, impact, and any safe
mitigation you found. DeltaDotta is local-first: reports must never include real
credentials, private repository contents, production records, or exported
organization packages.

## Security boundaries

DeltaDotta describes role authority; it does not enforce permissions in Claude,
Codex, or any other provider. The first-shift verifier is deliberately
read-only. Treat provider credentials, production access, and generated role
files as sensitive operational material and review them before use.
