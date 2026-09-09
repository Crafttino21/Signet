# Toolbox sync server

A small sync server for the Toolbox Obsidian plugin. It holds your notes without
being able to read them.

## What it does and does not do

The server stores two things: opaque encrypted blobs, and an ordered list of
encrypted commits. It has no idea what any of it means. Filenames live inside the
encrypted manifest, and blobs are filed under ids derived from a key it never
sees — so it cannot even tell whether two vaults hold the same document.

What it does know is how many blobs there are and roughly how large they are.
That is unavoidable for something that stores them, and saying so is the
difference between honest end-to-end encryption and a marketing claim.

**Nothing here ever deletes anything.** Commits are appended under a new sequence
number and never rewritten; blobs are content-addressed and never replaced. The
worst a broken client can do is add a version nobody wanted — it cannot destroy an
older one. Every past state of the vault stays reachable. That property is what
makes a self-built sync defensible at all, so treat it as load-bearing rather than
as an implementation detail.

It has **no runtime dependencies**: `node:http` and the filesystem. There is no
framework to keep patched on a machine that holds your notes.

## Installing on Debian

Requires Docker and the Compose plugin:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
```

Then, from a checkout of this repository:

```bash
cd packages/server
cp .env.example .env
openssl rand -hex 32   # paste into TOOLBOX_REGISTRATION_SECRET in .env
docker compose up -d --build
```

Check it:

```bash
curl http://127.0.0.1:8787/v1/health
# {"ok":true,"protocol":1,"vaults":0}
```

The container listens on `127.0.0.1` only, and the data lives in a Docker volume
that survives rebuilds.

### Put TLS in front of it

Your notes are encrypted before they leave the device, but the bearer token is
not, and neither is the fact that you are syncing. Do not expose the port
directly. With Caddy, the whole configuration is:

```
sync.example.com {
	reverse_proxy 127.0.0.1:8787
}
```

Or with nginx, a normal `proxy_pass` to `http://127.0.0.1:8787` behind certbot.

### Configuration

| Variable                      | Default      | Meaning                                                                                                                                                           |
| ----------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOOLBOX_REGISTRATION_SECRET` | _(required)_ | Needed to create a new vault. Without it the server refuses to start, because a sync server that silently accepts strangers is worse than one that will not boot. |
| `TOOLBOX_PORT`                | `8787`       | Listening port.                                                                                                                                                   |
| `TOOLBOX_DATA_DIR`            | `/data`      | Where vaults are kept.                                                                                                                                            |
| `TOOLBOX_MAX_BLOB_BYTES`      | `104857600`  | Largest single file.                                                                                                                                              |
| `TOOLBOX_MAX_MANIFEST_BYTES`  | `33554432`   | Largest manifest.                                                                                                                                                 |

The registration secret is only needed once per vault, when a device first
creates it. Everyday syncing authenticates with a token derived from your ring
code, which never reaches the server — only its hash does.

## Backups

The data directory is the whole state. Back up the Docker volume:

```bash
docker run --rm -v toolbox-data:/data -v "$PWD:/backup" alpine \
	tar czf /backup/toolbox-sync-backup.tar.gz -C /data .
```

The backup is as unreadable as the server itself. You need the ring code to make
sense of any of it — which also means **losing the ring code loses the notes**.
Keep it somewhere safe and separate.

## The protocol

| Method | Path                           | Purpose                                         |
| ------ | ------------------------------ | ----------------------------------------------- |
| `GET`  | `/v1/health`                   | Liveness. The only route needing no token.      |
| `POST` | `/v1/vaults/:id/register`      | Create a vault. Needs `X-Registration-Secret`.  |
| `GET`  | `/v1/vaults/:id/head`          | Current commit number.                          |
| `GET`  | `/v1/vaults/:id/commits/:seq`  | One sealed manifest.                            |
| `POST` | `/v1/vaults/:id/commits`       | Append a commit. `409` if the caller is behind. |
| `GET`  | `/v1/vaults/:id/blobs/:blobId` | One sealed blob.                                |
| `PUT`  | `/v1/vaults/:id/blobs/:blobId` | Store a sealed blob.                            |

Everything but health and register needs `Authorization: Bearer <token>`.

A `409` on push is not a failure — it means another device committed first, and
the client should pull, reconcile and try again. That check is what stops a device
that has not caught up from overwriting work it never saw.

## Development

The wire format and all cryptography live in `packages/protocol`, which both this
server and the plugin import. One implementation, so the two cannot drift — and
drift between the ends of a sync protocol is exactly what loses data.

```bash
npm run build          # bundles to dist/server.js
npx vitest run packages/server
```

The tests in `src/http.test.ts` run the real server over a real socket with real
encryption, including a check that a stored commit contains no readable filename.
