# Agent instructions

This repo deploys an Instagram comment auto-DM bot to Cloudflare Workers. To install it for a user, follow `docs/SETUP.md` from top to bottom.

## Rules

- Never print, echo, log or paste tokens, app secrets, verify tokens or the admin password. Read them from `.env` inside commands only (`set -a; . ./.env; set +a`). Upload them with `scripts/push-secrets.sh`.
- Never commit `.env` or `wrangler.toml` (both gitignored). Check `git status` before any commit.
- Do not take screenshots of screens that show tokens or secrets (Meta "Generate token" popup, "Instagram app secret" after Show).
- Steps marked `👤 사람` are for the user: password entry, OAuth "Allow", the Meta **Publish** button, accepting the tester invite. Tell the user exactly what to click and wait.
- Ask the user to confirm the `username` from the `/me` check before deploying. That account is the one that will send DMs.
- Testing needs a second Instagram account. Comments by the account owner are ignored by design.

## Code

- `src/logic.js`: pure flow logic (no I/O except the injected `acct.call` and `store`). Covered by `npm test`.
- `src/index.js`: Worker entry, D1 store, webhook signature check, admin auth.
- `src/admin.html`: admin GUI, vanilla JS, talks to `/api/state`, `/api/media`, `/api/post`, `/api/rules`.
- Run `npm test` after changing `src/logic.js`.
