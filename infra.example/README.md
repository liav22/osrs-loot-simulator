# infra — setup walkthrough

This directory is a **committed template**. It holds placeholders only, never real
IDs or secrets — those live in the gitignored `infra/` directory at the repo root,
which mirrors this layout.

`infra/` and everything under it (except `infra.example/`) is listed in `.gitignore`.

## When you need this

v1 of the loot simulator (Phases 0–5) needs none of this — it is a static site with
no backend. This directory only matters if you build Phase 6, the optional
Cloudflare Worker + D1 backend described in `PROJECT_PLAN.md` section 14.

## Setup

1. Copy this directory to `infra/` at the repo root (gitignored, safe for real values):

   ```sh
   cp -r infra.example infra
   ```

2. Fill in the placeholders:
   - `infra/cloudflare/wrangler.toml.example` → `infra/cloudflare/wrangler.toml`,
     replace `account_id = "REPLACE_ME"` with your real Cloudflare account ID.
   - `infra/cloudflare/.dev.vars.example` → `infra/cloudflare/.dev.vars`, fill in
     local secrets for `wrangler dev`.
3. Set the GitHub Actions repo secrets listed in `github/required-secrets.md`
   (Settings → Secrets and variables → Actions). Names only are documented here;
   never commit values.
4. Run the scripts in `scripts/` (also `.example` templates — copy and adapt them
   into `infra/scripts/` with real paths/names as needed).

## Files

| Path | Purpose |
|---|---|
| `cloudflare/wrangler.toml.example` | Worker config template |
| `cloudflare/.dev.vars.example` | Local dev secrets template for `wrangler dev` |
| `cloudflare/d1-schema.sql` | D1 (SQLite) schema for the optional backend |
| `scripts/deploy-worker.sh.example` | Deploy the Worker via `wrangler deploy` |
| `scripts/d1-migrate.sh.example` | Apply D1 migrations |
| `scripts/seed-d1.sh.example` | Seed D1 from `data/` |
| `github/required-secrets.md` | Names of repo secrets Actions needs (no values) |
