# Release DeltaDotta

This checklist is for project maintainers. It keeps package publication,
GitHub releases, and provider acceptance evidence aligned.

## Release gate

From a clean release branch:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:check
```

`release:check` runs the complete build and test suite, audits runtime and
development dependencies, and installs the packed CLI in a clean consumer
project.

Before publishing, also confirm:

- GitHub CI is green on Linux, macOS, and Windows.
- The Docker image builds.
- `package.json` and the newest changelog entry use the same version.
- A maintainer completed a sanitized live-provider evaluation in both ChatGPT
  and Claude.
- Private vulnerability reporting is enabled.
- No generated organization package, credential, or private source is included
  in the release diff or npm tarball.

Inspect the npm payload:

```bash
npm pack --dry-run
```

## Publish npm

The first publication creates the package from an authenticated maintainer
workstation. npm provenance is only available from a
[supported cloud CI provider](https://docs.npmjs.com/generating-provenance-statements/),
so disable the package's provenance default for this one local publication:

```bash
npm login
npm whoami
NPM_CONFIG_PROVENANCE=false npm publish --access public
```

Publishing is irreversible for that exact version. Do not run it until the
release commit and version are final.

After the package exists, configure
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and publish
future releases from CI with provenance enabled.

Verify from a new temporary folder:

```bash
npx --yes deltadotta@0.1.0 --version
```

## Tag and create the GitHub release

After npm publication:

```bash
git tag -s v0.1.0 -m "DeltaDotta v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 \
  --title "DeltaDotta v0.1.0" \
  --notes-file CHANGELOG.md \
  --verify-tag
```

If signed tags are not configured, configure signing before the release rather
than silently replacing the signed-tag step with an unsigned tag.

## Post-release verification

```bash
npm view deltadotta@0.1.0 version dist.integrity
npx --yes deltadotta@0.1.0 --version
```

Then run one fictional onboarding command from
[LOCAL-TESTING.md](LOCAL-TESTING.md) through the registry-installed CLI and
confirm that the package still stops at human review.
