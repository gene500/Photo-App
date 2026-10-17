# Project instructions

## After every push, check that Vercel deployed

A push is not finished until Vercel reports the deployment as done. After every `git push` to `gene500/Photo-App`, check the deployment for the commit you pushed before telling the user it is done.

1. Get the pushed commit: `SHA=$(git rev-parse HEAD)`.
2. Check the Vercel status for it (repeat every 30 seconds, for up to 10 minutes, while the state is `pending`):

   ```bash
   gh api repos/gene500/Photo-App/commits/$SHA/status \
     --jq '.statuses[] | select(.context | test("photo-app-pi2o")) | {state, description, target_url}'
   ```

3. Report the result:
   - `success`: say the deployment completed, and give the live URL `https://photo-app-pi2o.vercel.app`.
   - `failure` or `error`: say the deployment failed and give the `target_url` so the user can open the build log. Do not claim the change is live.
   - Still `pending` after 10 minutes: say so and give the `target_url`; do not guess.

Notes:
- Only the `photo-app-pi2o` project is the real site. Vercel also reports a `photo-app` project for each push; it is a duplicate empty project (see `HANDOFF.md`) and its status can be ignored.
- If nothing is reported for the commit at all, the push may not have triggered a deploy; say that rather than assuming success.
- A push to a branch other than `main` creates a preview deployment, not the live site. Say which one it is.

## Keep the to-do list in HANDOFF.md and update it as you go

The single to-do list and handoff file is `HANDOFF.md` (its "Task board"); there is no separate `TODO.md`.

For any job with more than one step, add the tasks to the Task board before starting work.

1. List every task up front, including review, verification and push/deploy steps, each as its own row.
2. Give every row a status: pending, in progress, completed, blocked, or removed.
3. Keep exactly one row in progress at a time. Mark it completed as soon as it is actually done and verified (tests run, output checked), not before.
4. Update the board the moment anything changes: a task finishes, a new task appears, a task is dropped or split, or something becomes blocked. If a task is blocked, say why in its notes. Commit the update with the work it describes.
5. Do not drop rows silently. If the user changes the plan, mark the old rows removed and add the new ones.
6. Whenever you report progress, the board is the source of truth: say which rows are done, which is in progress, and what is left. Write it so a different Claude session or machine can resume from the file alone.
