# SondenScanner

Watches [SondeHub](https://sondehub.org) for weather sondes (radiosondes) near you and sends a push notification to your phone via [ntfy](https://ntfy.sh).

- Notification with distance and direction, nearest place, height, rising/falling speed, frequency and predicted landing (time + place).
- **Red urgent warning** (ntfy priority 5) when a sonde is predicted to land within `WARN_KM` (default 30 km).
- Tapping the notification opens a live map served by the app: your radius, all sondes, predicted paths and landing points.

No npm dependencies, Node 24+.

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored and dockerignored, so it never ends up in git or in the image.

| Variable | Required | Default | Description |
|---|---|---|---|
| `LAT`, `LON` | yes | | Your position |
| `RADIUS_KM` | yes | | Notify about sondes whose predicted landing is within this distance |
| `WARN_KM` | | `30` | Urgent red warning when the predicted landing is within this distance |
| `NTFY_TOPIC` | yes | | ntfy topic name. Anyone who knows it can read it, so use a random one |
| `INTERVAL_MIN` | | `2` | Minutes between scans |
| `PORT` | | `3000` | Port of the map web server |
| `PUBLIC_URL` | | `http://localhost:PORT` | URL your phone uses to reach the map (put in the notification link) |
| `TZ` | | UTC in Docker | Time zone for landing times in notifications, e.g. `Europe/Berlin` |

On your phone: install the ntfy app and subscribe to your `NTFY_TOPIC`.

## Run locally

```bash
npm start   # reads .env
npm test
```

## Production (Docker)

The image is published to `ghcr.io/pascalschwab/sondenscanner`. Put your `.env` next to `compose.yaml` on the server:

```bash
docker compose up -d
```

or without compose:

```bash
docker run -d --restart unless-stopped --env-file .env -p 3000:3000 ghcr.io/pascalschwab/sondenscanner:latest
```

If the package is private, log in first: `docker login ghcr.io` (with a GitHub token that has `read:packages`).

The container runs as the non-root `node` user, and `compose.yaml` adds a read-only filesystem, drops all capabilities and sets `no-new-privileges`. The map has no login, so put it behind your reverse proxy (HTTPS, optionally auth) if the server is public.

## Releasing

`.github/workflows/main.yaml` runs on pushes to `main` whose commit message contains `[build]`:

1. `npm test`
2. Reads `version` from `package.json` and skips the rest if release `v<version>` already exists
3. Builds the Docker image and pushes the tags `<version>` and `latest` to GHCR
4. Creates the git tag and GitHub release `v<version>`

To release: bump `version` in `package.json` and commit with `[build]` in the message.
