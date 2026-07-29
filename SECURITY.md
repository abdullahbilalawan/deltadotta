# Security policy

## Supported versions

Security fixes are made on the latest release line.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability. Use the
[private vulnerability report](https://github.com/abdullahbilalawan/deltadotta/security/advisories/new)
on the canonical GitHub repository. GitHub sends that report privately to the
maintainers. If you are using a mirror, report through the canonical repository
rather than disclosing details on the mirror.

Include a clear reproduction, affected version or commit, impact, and any safe
mitigation you found. DeltaDotta is local-first: reports must never include real
credentials, private repository contents, production records, or exported
organization packages.

## Security boundaries

DeltaDotta describes role authority; it does not enforce permissions in Claude,
ChatGPT, Claude Code, Codex, or any other provider. Provider evaluation and
first-shift verification are deliberately read-only by default. Treat provider
credentials, production access, and generated organization packages as
sensitive operational material and review them before use.
