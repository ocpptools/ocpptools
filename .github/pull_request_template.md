## Summary

<!-- What problem does this solve, and how? Link the issue, for example "Fixes #123". -->

## Checklist

- [ ] Title follows Conventional Commits (it becomes the squash commit).
- [ ] Commits are signed off (`git commit -s`, see CONTRIBUTING.md).
- [ ] Tests added or updated for behavior changes.
- [ ] Changeset added if a published package changed (`pnpm changeset`).
- [ ] Docs updated if behavior or APIs changed (see docs/STYLE.md).
- [ ] `pnpm verify` passes locally, or I explain below what I could not run.
- [ ] No secrets, private content, private website references, AI-assistant
      files, or OCPP schemas outside `packages/schemas`.
