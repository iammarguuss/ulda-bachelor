# Backup Guide

## Scope and strategy

This backup guidance is focused on the main deployment target:

- `applications/ulda-crud`

Because this is a demo/research deployment, the most important assets are the database contents and the runtime configuration needed to reconnect the server to that data.

Recommended strategy:

- back up MySQL regularly
- keep configuration backups separate from the repository
- retain enough history to recover from accidental deletion or a bad update

## What should be backed up

### Database

The highest-priority backup item is the MySQL database used by `ulda-crud`, including the `main` table and any future schema additions.

Recommended method:

- logical dump with `mysqldump`

### Configuration

Back up deployment-local configuration files such as:

- `applications/ulda-crud/.env`
- any process manager config, if used
- any reverse proxy config, if used

Do not commit these runtime-specific files to Git.

### Logs and diagnostics

If logs are stored outside the terminal session, back up only what is useful for debugging or audit within the demo context. This may include:

- service logs
- reverse proxy logs
- container logs exported to files

Logs are usually lower priority than database and configuration backups.

## Recommended backup frequency

For a student/demo deployment:

- database: daily, or before every significant demo/update
- configuration: after each intentional config change
- logs: optional weekly export or before major troubleshooting work

At minimum, create a fresh backup:

- before every update
- before schema or environment changes
- before resetting or recreating MySQL volumes/containers

## Storage and rotation recommendations

- store backups outside the working tree
- keep at least 3 to 7 recent database backups
- keep at least one known-good backup from before the latest deployment
- if Docker volumes are used, do not rely only on the volume itself as a backup strategy

For a small research environment, a practical rotation policy is:

- daily backups for 7 days
- weekly backups for 4 weeks

## Example backup commands

### MySQL logical backup

```bash
mysqldump -h 127.0.0.1 -P 3306 -u ulda -p ulda > ulda_backup.sql
```

Replace the host, port, user, and database name with the deployed values. Avoid putting real passwords directly into shared shell history when working on a multi-user machine.

### Configuration backup

```bash
cp applications/ulda-crud/.env backups/ulda-crud.env.backup
```

On Windows, copy the file manually or use:

```bat
copy applications\ulda-crud\.env backups\ulda-crud.env.backup
```

## Integrity verification

Every backup process should include a simple verification step.

Recommended checks:

- confirm the SQL dump file is not empty
- inspect the first lines of the dump for the expected database/table metadata
- if archives are used, test that they can be opened
- store checksums when practical

For example:

```bash
ls -lh ulda_backup.sql
head -n 20 ulda_backup.sql
```

## Restore procedure

### Database restore

1. Ensure the target MySQL server is available.
2. Create the target database if needed.
3. Import the dump:

```bash
mysql -h 127.0.0.1 -P 3306 -u ulda -p ulda < ulda_backup.sql
```

4. Re-check the `main` table and row count.

### Configuration restore

1. Restore the saved `.env`.
2. Re-check database host, port, username, and password.
3. Start the application again.

### Post-restore verification

After restore:

- call `http://localhost:8787/health`
- call `http://localhost:8787/config`
- read a known record if test data is available
- open `http://localhost:8787/browser-test/`

## Test restore recommendation

A backup policy is only trustworthy if restores are tested. For this repository, a reasonable academic practice is:

- perform a restore rehearsal at least once per milestone or release
- restore into a temporary MySQL instance or Docker container
- verify that `ulda-crud` can start against the restored data

This level of testing is usually enough to defend the backup approach for a coursework/demo deployment without claiming enterprise-grade disaster recovery.
