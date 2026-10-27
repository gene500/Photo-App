# Project instructions (Photo Op Planner)

General working rules (testing before claiming, task board format and ID prefixes, subagent models, parallel work, agent memory limit, handoff) live in the global `~/.claude/CLAUDE.md` and apply here too. This file holds only what is specific to this project.

## After every push, check that Vercel deployed

A push is not finished until Vercel reports the deployment as done. After every `git push` to `gene500/Photo-App`, check the deployment for the commit you pushed before telling the user it is done.

1. Get the pushed commit: `SHA=$(git rev-parse HEAD)`.
2. Check the Vercel status for it (repeat every 30 seconds, for up to 10 minutes, while the state is `pending`):

   ```bash
   gh api repos/gene500/Photo-App/commits/$SHA/status \
     --jq '.statuses[] | select(.context | test("photo-app-pi2o")) | {state, description, target_url}'
   ```

3. Also check CI for the same commit (`check` and `e2e` must both succeed): `gh api repos/gene500/Photo-App/commits/$SHA/check-runs`.
4. Report the result:
   - `success`: say the deployment completed, and give the live URL `https://photo-app-pi2o.vercel.app`.
   - `failure` or `error`: say the deployment failed and give the `target_url` so the user can open the build log. Do not claim the change is live.
   - Still `pending` after 10 minutes: say so and give the `target_url`; do not guess.

Notes:
- Only the `photo-app-pi2o` project is the real site. Vercel also reports a `photo-app` project for each push; it is a duplicate empty project (see `docs/HANDOFF.md`) and its status can be ignored.
- If nothing is reported for the commit at all, the push may not have triggered a deploy; say that rather than assuming success.
- A push to a branch other than `main` creates a preview deployment, not the live site. Say which one it is.

## Task board and handoff

- The single to-do list and handoff file is `docs/HANDOFF.md` (its "Task board" and "Current work"); there is no separate `TODO.md`. The board format, ID prefixes and ordering rules are in the global file.
- The standing last two rows of every list are SEC (`/security-review`) and FINAL. FINAL here means: full codebase check on Opus, merge, push to `main`, and confirmation that Vercel (`photo-app-pi2o`) and CI (`check`, `e2e`) both succeeded.

## Project notes

- Next.js 16: `AGENTS.md` says to read `node_modules/next/dist/docs/` before writing Next.js code.
- Never print or commit the Mapbox `pk.` token or any `TURSO_*` secrets.
- Tests: run the full vitest suite alone (`fileParallelism` is off); Playwright e2e runs on port 3100 (`E2E_PORT` overrides) against a fresh `e2e.db` with fake externals. Agents that run e2e in their own repo copy must copy `node_modules` (`cp -cR`), not symlink it, because a symlink breaks Turbopack.
- `.vscode/settings.json` keeps VS Code from watching `.next`, `.next-e2e` and `node_modules`.
