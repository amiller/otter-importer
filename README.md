# otter-importer

CLI importer for **Otter.ai** transcripts. It lists the conversations your Otter
account can see (owned + shared), pulls each diarized transcript, normalizes it,
and publishes it to TinyCloud as a Listen `conversation` — the same SQL + KV shape
Listen's own Fireflies / Google Meet / Granola sources write.

Otter has **no public API**. There are two ways to read it:

- **Token-only (delegated, no cookie) — the OAuth3 way.** The importer holds only a
  scoped read token and reads Otter through an OAuth3 instance. It never sees the Otter
  cookie. This is the first-class flow (see below).
- **Cookie (legacy/local fallback).** Reuse the session cookie from a browser you're
  already logged into; the cookie stays on **your machine**.

## Install

```sh
bun install
bun link        # exposes `otter-importer`
```

## Token-only (delegated, no cookie) — the OAuth3 way

Point the importer at an OAuth3 instance with `--node` (or `OAUTH3_NODE`). The user
approves `otter-importer` on their instance once; the app then holds only a **scoped
read token** and reads notes/transcripts through the instance. **The Otter cookie never
leaves the user's OAuth3 instance** — this tool never holds it.

```sh
otter-importer init

# scoped token already minted on the instance:
OAUTH3_NODE=https://<instance> OAUTH3_TOKEN=<token> otter-importer scan
OAUTH3_NODE=https://<instance> OAUTH3_TOKEN=<token> otter-importer pull

# or omit the token to run the approval handshake (prints an approve URL to visit):
OAUTH3_NODE=https://<instance> otter-importer scan
```

`--token`/`OAUTH3_TOKEN` is the scoped read token; `--subject` sets the attribution
carried by the token. `scan`/`pull`/`status`/`list` work identically — only the source
changes. (`upload` to TinyCloud still needs `tc` auth; that leg is unchanged.)

## Auth (cookie — legacy/local fallback)

1. **TinyCloud** — authenticate the `tc` CLI for your space (see the `listen` /
   `listen-importer` docs). `otter-importer auth` should print your status.
2. **Otter cookie** — grab `sessionid` + `csrftoken` from a logged-in otter.ai session:
   - `python3 scripts/dump_cookie.py` (needs `pip install browser_cookie3`, Chrome), or
   - browser devtools: otter.ai → Application → Cookies → copy `sessionid` and `csrftoken`.

   ```sh
   otter-importer cookie --sessionid <sessionid> --csrftoken <csrftoken>
   ```

   Stores `~/.otter-importer/cookie.json` (mode 600). `OTTER_SESSIONID` /
   `OTTER_CSRFTOKEN` env vars work too.

## Use

```sh
otter-importer init
otter-importer scan                 # list speeches (owned+shared) into the local db
otter-importer pull                 # fetch + parse transcripts for new/changed speeches
otter-importer upload               # publish them to TinyCloud (Listen conversations)
otter-importer status
```

`scan` re-detects edited transcripts (via Otter's `transcript_updated_at`), so the
loop is incremental and resumable. These commands work the same whether the source is
the token-only OAuth3 path (`--node`) or the cookie fallback.

## What it writes

For each Otter speech, a Listen conversation:

- `conversation` row in `xyz.tinycloud.listen/conversations` (`source = "otter"`,
  `source_id = "otter:<otid>"`, with inline `transcript_json` / `transcript_text`),
- `participant` rows (one per distinct speaker name),
- a transcript blob in KV at `xyz.tinycloud.listen/transcript/otter-<otid>`.

Transcripts use Otter's diarized export (real speaker names + per-segment start
times). Frames and audio are out of scope for v1 — this is transcript-first.

## Layout

```
src/cli.ts          commands
src/otter.ts        Otter unofficial-API client (cookie path: user, speeches, bulk_export)
src/otter-oauth3.ts token-only source: reads Otter via an OAuth3 instance (oauth3-sdk)
src/cookie.ts       cookie resolution + storage
src/transcript.ts   diarized .txt -> normalized sentences
src/db.ts           local SQLite state (bun:sqlite)
src/upload.ts       publish to TinyCloud via the tc CLI
```
