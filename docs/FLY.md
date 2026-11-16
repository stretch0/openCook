# Hosting openCook on Fly.io

No server of your own? [Fly.io](https://fly.io) runs openCook as one small machine with your data on a volume. It takes about ten minutes and costs a few dollars a month: one shared-CPU machine with 512 MB, and a 1 GB volume (check [Fly's pricing](https://fly.io/docs/about/pricing/)).

You need a Fly account and [`flyctl`](https://fly.io/docs/flyctl/install/), signed in with `fly auth login`.

## Set it up

1. Download [`deploy/fly/fly.toml`](../deploy/fly/fly.toml) into an empty folder:

   ```bash
   curl -O https://raw.githubusercontent.com/stretch0/openCook/main/deploy/fly/fly.toml
   ```

2. In `fly.toml`, change:
   - `app`, to a name of your own. App names are shared across all of Fly, so pick something unlikely to be taken.
   - `ORIGIN`, to `https://<your app name>.fly.dev`, or your own domain (see [Your own domain](#your-own-domain)).
   - `primary_region`, to the region nearest you (`fly platform regions` lists them).

3. Create the app, its volume and its secret, then deploy. Replace `my-opencook` and `lhr` with your app name and region:

   ```bash
   fly apps create my-opencook
   fly volumes create opencook_data -a my-opencook --region lhr --size 1
   fly secrets set -a my-opencook BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
   fly deploy --ha=false
   ```

   `--ha=false` keeps it to one machine. Don't add a second: each would have its own database.

4. Open your `ORIGIN` and create your account. The first account becomes the admin. Then invite people from **Admin**: `INVITE_ONLY` is on, since the app is on the internet.

`BETTER_AUTH_SECRET` signs everyone's sessions. Fly keeps it, but you can't read it back, so if you might ever move off Fly, set it from a value you've saved somewhere safe instead.

## Your own domain

```bash
fly certs add cook.example.com -a my-opencook
```

Add the DNS records it prints, then set `ORIGIN` to `https://cook.example.com` and run `fly deploy` again. Passkeys are tied to the hostname, so do this before anyone adds a passkey; after a change, everyone adds theirs again.

## Upgrading

`fly.toml` pins a release line, such as `0.1`. Back up first (below), then:

- **Fixes in the same line:** `fly deploy`.
- **The next release line:** change the image tag in `fly.toml` (for example `:0.1` to `:0.2`), then `fly deploy`.

Database updates are applied when openCook starts (`fly logs` shows "Applied 1 database update"), and can't be undone except by restoring a backup.

## Backups

Fly takes a snapshot of the volume every day and keeps it for 5 days (`fly volumes snapshots list <volume id>`; `fly volumes list` shows the id). A volume lives on one server, so if that server fails, a snapshot is what you get back: up to a day old. To restore one, see Fly's guide to [restoring from a snapshot](https://fly.io/docs/volumes/snapshots/).

For a copy you keep yourself, back up the database while openCook runs, then download it:

```bash
fly ssh console -a my-opencook -C "node backup.js /data/backups/opencook.db"
fly ssh sftp get /data/backups/opencook.db opencook-$(date +%F).db -a my-opencook
fly ssh console -a my-opencook -C "rm /data/backups/opencook.db"
```

That's the database: accounts, recipes, notes and settings. Photos are in `/data/uploads`.

## Forgotten passwords

```bash
fly ssh console -a my-opencook -C "node reset-password.js someone@example.com"
```

It prints a temporary password and signs that person out everywhere. Send it to them privately.

## Things to know

- **It sleeps when idle.** `auto_stop_machines = 'stop'` lets Fly stop the machine when nobody's using it; the next request (from the app or an AI assistant) wakes it in a second or two. Set it to `'off'` and `min_machines_running = 1` if you'd rather it stayed up.
- **Deploying from GitHub:** set the repository variable `FLY_APP` and the secret `FLY_API_TOKEN`, and every push to `main` deploys the image it builds.
- **Logs:** `fly logs -a my-opencook`.
- **Every other setting** in [.env.example](../.env.example) can go under `[env]` in `fly.toml`.
