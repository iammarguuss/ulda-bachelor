# Update Guide

## Scope

This update procedure is written for the main deployment target:

- `applications/ulda-crud`

It assumes a small demo or research installation with either a host-based Node.js deployment or a simple Docker-based deployment.

## Preparation before update

1. Identify the currently deployed commit or tag.
2. Read the incoming repository changes, especially:

- `README.md`
- `docs/deployment.md`
- `applications/ulda-crud/.env.example`
- `applications/ulda-crud/src/server.js`

3. Confirm that the maintenance window is acceptable for the intended audience.
4. Ensure backup storage is available before any code replacement.

## Compatibility check

Before applying an update, check:

- Node.js version is still compatible with the application requirement (`>=18`)
- MySQL version remains 8.0 or newer
- expected environment variables still exist
- the updated code does not rely on removed local customizations

If `.env.example` changed, compare it with the deployed `.env` and merge only the necessary differences.

## Backup before update

Always take at least:

- a MySQL dump of the target database
- a copy of the deployed `.env`
- a copy of any service wrapper or reverse proxy configuration used around the app

Detailed backup recommendations are documented in:

- `docs/backup.md`

## Downtime expectations

For a small demo deployment, short downtime is acceptable and easier to manage than a hot in-place update.

Expected downtime usually covers:

- stopping the Node.js process or containers
- replacing code or pulling changes
- reinstalling dependencies if lockfiles changed
- running post-update verification

In a typical student/demo environment, plan for 5 to 15 minutes.

## Stop sequence

### Host-based deployment

1. Stop the running `ulda-crud` process.
2. Confirm that port `8787` is no longer in use.

### Docker-based deployment

1. Go to `applications/ulda-crud`.
2. Stop the compose stack:

```bash
docker compose down
```

If you also want to remove anonymous temporary resources, review the compose state first and clean them deliberately.

## Code replacement/update steps

### Git-based update

From the repository root:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

If the deployment is intentionally pinned to a tag, checkout that tag or the release commit instead of pulling the branch tip.

### Dependency refresh

From the repository root:

```bash
npm install
```

From `applications/ulda-crud`:

```bash
npm install
```

If the application is deployed from a prebuilt container image, rebuild the image instead of running `npm install` on the host.

## Configuration update steps

1. Compare the deployed `.env` with `applications/ulda-crud/.env.example`.
2. Add new keys if required.
3. Keep deployment-specific secrets and hostnames in the real `.env`, not in version control.
4. Re-check:

- `PORT`
- database host and credentials
- any Docker-related fallback variables that should be disabled in a managed deployment

## Start sequence

### Host-based deployment

From `applications/ulda-crud`:

```bash
npm run dev
```

For a more production-like foreground start:

```bash
node src/server.js
```

### Docker-based deployment

From `applications/ulda-crud`:

```bash
docker compose up --build -d
```

## Post-update verification

Run the same checks as in the deployment guide:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/config
```

Then also verify:

- browser test page loads
- the application can connect to MySQL
- existing records can still be read
- create/update/delete requests behave as expected for a known test dataset

If repository maintenance tooling is available on the deployment machine, it is also reasonable to run:

```bash
npm run check
```

## Rollback procedure

If verification fails:

1. Stop the updated application.
2. Return the repository to the previous known-good commit or tag.
3. Restore the previous `.env` if it was changed.
4. Restore the MySQL backup only if the update introduced incompatible or corrupted data changes.
5. Start the previous version.
6. Re-run health and smoke checks.

### Example rollback with Git

```bash
git checkout <previous-known-good-commit-or-tag>
cd applications/ulda-crud
npm install
node src/server.js
```

For Docker-based deployment, rebuild or re-run the previously known-good image/compose revision.
