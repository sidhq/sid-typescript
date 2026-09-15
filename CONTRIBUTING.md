# Contributing to the SID TypeScript SDK

These instructions are for building and maintaining the SDK from source.
The published npm package already includes the compiled snippet engine; users
only need `npm install @sid-ai/sid-sdk`.

## Build and package

`npm run build` builds Rust into WASM, generates the Node bindings, and compiles
TypeScript in one command. CI performs this build and packages the resulting
JavaScript, declarations, and WASM before publishing to npm. Consumers never
compile Rust during installation.

After installing the development tools listed below:

```sh
npm ci
npm run build
npm pack
```

## Development

Install Node.js 22+ and Rust through rustup. The checked-in toolchain selects
Rust 1.88.0 and the WASM target.

```sh
cargo install wasm-bindgen-cli --version 0.2.100 --locked
npm ci
npm run check
```

The ignored `sid-python/` checkout is only a development reference. To regenerate
fixtures, check out the pinned revision, build its extension with the Python
project's development instructions, then run:

```sh
sid-python/.venv/bin/python scripts/generate-python-fixtures.py
```

Normal builds and CI require no Python checkout. `npm run test:package` installs
the tarball into a temporary directory with lifecycle scripts disabled, checks
both module formats, and compiles TypeScript consumers.

## Releases

Every successful push to `main` publishes its head revision, including documentation
changes. CI tests Node 22 and 24 on Linux, macOS, and Windows before publishing.
Versions begin at `0.1.0` and automatically increment the highest published or
reserved patch version. Versions change only in the release workspace; Git tags
identify source revisions, whose package manifest retains the development version.

The release queue serializes runs (up to GitHub's 100 pending-run limit). A `v*`
tag reserves a version for a SHA before publication. Rerun a failed workflow to
reuse that version and recover missing GitHub release metadata. Do not delete or
move reservation tags. Network, authorization, and version conflicts fail loudly.
An older delayed revision gets a `revision-<sha>` npm tag, so it cannot move
`latest` backward. npm publishing selects the tag directly and needs no separate
token-authorized `npm dist-tag` operation.

### One-time npm setup

1. Ensure the publishing account can create public packages in the `sid-ai` npm organization.
2. Add a narrowly scoped, short-lived granular npm token as the repository/environment
   secret `NPM_TOKEN`, with creation/publish rights and any required 2FA bypass.
   Rerun the initial Release workflow to publish the fully tested `0.1.0` package.
3. In the npm package settings, configure a GitHub trusted publisher: organization
   `sidhq`, repository `sid-typescript`, workflow `release.yml`, environment `npm`.
   Allow direct `npm publish`. Avoid required environment approvals if releases
   should remain automatic.
4. Remove the bootstrap secret and revoke the token. Subsequent runs authenticate
   with GitHub OIDC and publish with provenance.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Reference and compatibility testing

The ignored `sid-python/` checkout was used to port the original SDK and generate
compatibility fixtures. It is optional: it is not tracked by Git, included in
npm packages, or needed for normal builds or tests. Only fixture regeneration
requires the checkout and its Python environment. The implementation and fixtures
needed for normal development are committed in this repository.

The reference is [`sidhq/sid-python` at `c25f929`](https://github.com/sidhq/sid-python/tree/c25f9299a90d17735473ca401ae45fa4b41e25d8).
The Rust algorithm and Alyze 0.1.5 are retained. Tests include Python-generated
snippet offsets and exact XML/Markdown fixtures, including every language.

Seeded ID streams are reproducible within this SDK but do not reproduce Python's
random seed expansion. Fork sharing and collision-free permutation semantics are
preserved. Invalid input throws `TypeError` or `RangeError`; document lookup
failures throw `Error`.
