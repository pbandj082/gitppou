# Changesets

Add a changeset for user-facing changes:

```sh
pnpm changeset
```

Gitppou uses Changesets for semantic package versions and repository action tags. npm publishing is intentionally not configured.

When changesets are merged to `main`, the release workflow opens a version PR. When that version PR is merged, the workflow creates a repository tag like `v0.1.0` from the `@gitppou/action` package version so workflows can reference `owner/gitppou@v0.1.0`.
