# cockpit

Two entrypoints, one Bun package:

- `cockpit`: CLI for creating/attaching to Sprite-based agent sessions
- `cockpit-web`: local web dashboard + embedded agent UI

## Setup

```bash
bun install
```

## Run

```bash
# CLI help
bun run cli -- --help

# Web dashboard (default http://0.0.0.0:3000)
bun run web
```

## Install CLI

```bash
just install
cockpit --help
```

## Docs

- Web dashboard notes: `docs/web-server.md`
