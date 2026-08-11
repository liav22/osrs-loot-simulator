# Required GitHub Actions secrets

Names only — never values. Set these under Settings → Secrets and variables →
Actions on the real repo.

| Secret | Needed for | Phase |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Worker/D1 deploy | 6 |
| `CLOUDFLARE_ACCOUNT_ID` | Worker/D1 deploy | 6 |
| `INGEST_PAT` | Letting the wiki-sync PR trigger CI (the default `GITHUB_TOKEN` cannot) | 3 |
