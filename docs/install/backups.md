# Off-site backups

Backups kept on the server only are lost with the server (a dead disk, a deleted VPS, a provider incident). Settings > Backup can send a copy of every scheduled backup to a storage bucket at a provider of your choice, encrypted if you want, and restore from it in a few clicks. This page covers the providers, the settings, encryption, restoring, and how to check that it all works.

Available languages: English, [Français](backups.fr.md).

## What is backed up

- **The store archive** (`.shopme`): products, orders, customers, content, theme files, uploaded files and settings. Staff accounts, passwords and the off-site settings themselves are not part of it.
- **The database dump**, on a single-store installation where the app can run `pg_dump` (see below): it also holds staff accounts and everything else in PostgreSQL. Without `pg_dump`, only the store archive is sent.

The official Docker image does not include `pg_dump`. To get dumps, either build your own image `FROM` ShopMe's with the PostgreSQL 17 client installed (`apt-get install postgresql-client-17` from the PostgreSQL apt repository), or point `PG_DUMP_PATH` at a binary the app can run. The version must be at least that of the database. The dump is streamed (never held in memory) and the database password goes through the process environment, not the command line.

## Set it up

1. Create a bucket at a storage provider, and an access key restricted to that bucket (read, write, list and delete).
2. Open Settings > Backup > Off-site backup.
3. Pick the provider (the endpoint and the addressing style are filled in; adjust the region), then the bucket, an optional folder, the access key and its secret.
4. Optionally set an encryption passphrase.
5. Press **Test connection**: ShopMe writes a small file, reads it back and deletes it. Fix what the message says, then **Save**.

From then on, every scheduled local backup (Settings > Backup > Automatic backups) is uploaded right after it is made, and the retention schedule is applied. **Back up and send now** does the same on demand.

The secret key and the passphrase are encrypted on the server and never shown again; leaving their fields empty keeps the saved values.

### Providers

| Provider | Endpoint | Region examples | Notes |
| --- | --- | --- | --- |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | `us-west-004`, `eu-central-003` | Use an application key limited to the bucket. |
| Scaleway Object Storage | `https://s3.<region>.scw.cloud` | `fr-par`, `nl-ams` | |
| OVHcloud Object Storage | `https://s3.<region>.io.cloud.ovh.net` | `gra`, `rbx` | Use the S3 credentials of a user with the object storage role. |
| Wasabi | `https://s3.<region>.wasabisys.com` | `eu-central-1`, `us-east-1` | |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | Replace `<account-id>` with your Cloudflare account id. |
| Amazon S3 | `https://s3.<region>.amazonaws.com` | `eu-west-3`, `us-east-1` | |
| MinIO / other S3-compatible | your server's address | any | Tick path-style addressing. |

Any service that speaks the S3 protocol works with the MinIO / custom entry.

### Costs, in general terms

Storage providers bill for the space used, and some also for downloads (egress), for requests, or for a minimum retention period. A store archive is usually a fraction of your total media size, and the retention schedule bounds how many copies exist. Before choosing, compare the provider's billing for stored volume, restores (downloads) and deletions made before a minimum storage duration. Check the current price list at the provider; this page deliberately gives no figures.

## Retention

Set how many **daily**, **weekly** and **monthly** backups to keep. After each successful upload ShopMe keeps the newest backup of each of the last N days, of the last N ISO weeks (Monday first) and of the last N months (all in UTC), and deletes the others. Days without a backup do not count, so a quiet period never erases history. The newest backup is always kept. Only files named like ShopMe's own (`backup-<date>.shopme`, `db-<date>.dump`, with `.enc` when encrypted) are ever deleted; anything else you put in the bucket is left alone.

Default: 7 daily, 4 weekly, 6 monthly.

## Where files go

```
<folder>/shop-<store id>/archives/backup-2026-11-06T03-30-00Z.shopme[.enc]
<folder>/shop-<store id>/database/db-2026-11-06T03-30-00Z.dump[.enc]
```

Each store has its own folder, so stores of a multi-store installation can share one bucket without seeing each other: a store can only list, download or restore files under its own folder.

## Failures and the banner

Every upload is recorded in the history (time, size, status, error). A failed upload is retried automatically after 5 minutes, 15 minutes, 1 hour and 4 hours (five attempts in total), also after a server restart. A banner appears on the home page and in Settings > Backup when the last off-site backup failed, or when no backup reached the bucket for more than 48 hours. A final failure is also added to the activity feed. The banner clears itself after the next successful upload.

## Encryption

With a passphrase, each backup is encrypted on your server with AES-256-GCM before upload (the key comes from scrypt, with a random salt per file). The provider only sees unreadable data. Files get the extension `.enc`.

**If you lose the passphrase, the encrypted backups cannot be recovered. Nobody can open them, including the ShopMe authors.** Keep a copy in a password manager, apart from the server. Changing the passphrase only applies to new backups; older files still need the passphrase they were made with.

Without ShopMe (for example after losing the server), decrypt a file with the standalone script, which needs only Node.js 18 or newer:

```bash
SHOPME_BACKUP_PASSPHRASE='your passphrase' \
  node scripts/decrypt-backup.mjs backup-2026-11-06T03-30-00Z.shopme.enc backup.shopme
```

The format is documented at the top of `packages/core/src/offsite/crypto.ts` and of the script.

## Restoring

### On a working installation

Settings > Backup > Off-site backup > **Show backups** lists the files in the bucket, newest first, with **Download** (decrypted) and **Restore**. Restore opens a confirmation that explains what happens:

- **Replaced:** products, orders, customers, content, theme files, files and settings.
- **Lost:** everything created or changed since the backup.
- **Not changed:** staff accounts and passwords, the off-site settings and the files in the bucket.

Tick the box and confirm: the file is downloaded (and decrypted), then restored with the same process as Settings > Backup > Import a store. Export your store first if you are unsure.

### After losing the server

1. Install ShopMe on a new server (see [the install guide](README.md)) and create the first account.
2. Open Settings > Backup > Off-site backup, enter the same bucket, access key and, if you used one, the same passphrase, then **Show backups** and restore the newest.

If you prefer to work from files: download the `.shopme` (or decrypt the `.enc` with the script above), then use Settings > Backup > Import a store.

To restore a database dump, use PostgreSQL's own tool on an empty database: `pg_restore --no-owner -d shopme db-2026-11-06T03-30-00Z.dump`.

## Multi-store

Each store sets its own destination, history and banner in its Settings > Backup. The platform owner can also set a **platform destination** in the platform area (Platform > Backups) that backs up the whole installation once a day: one archive per store and, when `pg_dump` is available, the database. Its files live under `<folder>/platform/`. Restoring from the platform destination is done by downloading a store's archive and importing it in that store's Settings > Backup. A store destination never receives the whole-database dump.

## Safety

- **Endpoints** must be public hosts over `https://`. Private, loopback and link-local addresses (including cloud metadata addresses) are refused, and re-checked at connection time. A MinIO on your own network needs `BACKUP_ALLOW_PRIVATE_ENDPOINTS=true` in the server environment, which also allows `http://`.
- Secrets are never returned by the API, never written to logs or error messages, and never included in `.shopme` exports.
- Uploads are streamed in parts of 8 MB: the server never holds a whole archive in memory.

## Test your restore regularly

A backup you have never restored is a hope, not a backup. Once a month:

1. Press **Test connection**, and check that the history shows recent green entries.
2. Install ShopMe on a spare machine (or a local Docker Compose), restore the newest backup from the bucket, and open the storefront and a few orders.
3. Check that you can still find the passphrase and the bucket keys without access to the production server.

## Settings reference

| Variable | Purpose |
| --- | --- |
| `BACKUP_ALLOW_PRIVATE_ENDPOINTS` | `true` lets the destination be on a private or loopback address (a local MinIO). Default `false`. |
| `PG_DUMP_PATH` | Path of the `pg_dump` binary used for database dumps. Default: `pg_dump` from the `PATH`, when there is one. |
