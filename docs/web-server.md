# Cockpit Web Dashboard

Web dashboard for managing multiple pi coding agent sessions (sprites).

Built with [Bun](https://bun.sh) + [Elysia](https://elysiajs.com) for fast SSR.

## Features

- **Dashboard**: Server-rendered page listing all sprites with status
- **Agent UI**: Full-featured chat interface with WebSocket streaming
- **Remote Sprites**: Link to external Fly.io sprites or other pi instances
- **REST API**: Programmatic sprite management
- **Persistence**: Optional file-based sprite data storage

## Quick Start

```bash
bun install
bun run web
```

Open http://localhost:3000 to see the dashboard.

## CLI Usage

```bash
# Start dashboard on default port (3000)
bun run src/web/cli.ts

# Custom port
bun run src/web/cli.ts --port 8080

# Bind to specific host
bun run src/web/cli.ts --host 127.0.0.1

# Persist sprite data to disk
bun run src/web/cli.ts --data-dir ~/.pi/web-server

# Show help
bun run src/web/cli.ts --help
```

## Workspace Directory

By default, repos are cloned into:

- `${HOME}/workspace` (if HOME is set)
- Or the current working directory

You can override with:

```bash
export PI_WORKSPACE_DIR=/path/to/workspace
# or
export SPRITE_WORKSPACE_DIR=/path/to/workspace
```

The server will create the directory if it doesn't exist.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Pi Web Server                                      │
│                                                     │
│  Dashboard (SSR)           REST API                 │
│  GET /                     GET  /api/sprites        │
│  GET /sprites/:id          POST /api/sprites        │
│  GET /sprites/new          DELETE /api/sprites/:id  │
│  POST /sprites/new         PATCH /api/sprites/:id/..│
│                                                     │
│  Agent UI                  WebSocket                │
│  GET /sprites/:id/ui       WS /api/sprites/:id/ws   │
│                                                     │
└─────────────────────────────────────────────────────┘
         │                          │
         │   Local sprites run      │   Remote sprites
         │   agent in-process       │   redirect to URL
         ▼                          ▼
    ┌─────────┐              ┌─────────────┐
    │ pi-agent│              │ Fly.io etc  │
    │ (local) │              │ (remote)    │
    └─────────┘              └─────────────┘
```

## Sprite Types

### Local Sprites

Created via the dashboard or API without a URL. The pi coding agent runs in-process on the web server with full bash/file access to the cloned repository directory.

```bash
# Create local sprite via API
curl -X POST http://localhost:3000/api/sprites \
  -H "Content-Type: application/json" \
  -d '{"name": "feature-auth", "cwd": "/path/to/project"}'
```

### Remote Sprites

Created with a `url` field pointing to a Fly.io sprite or any host running pi. The dashboard links directly to the remote UI.

```bash
# Create remote sprite via API
curl -X POST http://localhost:3000/api/sprites \
  -H "Content-Type: application/json" \
  -d '{"name": "feature-x", "cwd": "/app", "url": "https://sprite-abc.fly.dev"}'
```

## Agent UI Features

The embedded agent UI includes:

- Real-time message streaming via WebSocket
- Collapsible tool execution output
- Stop/abort button during generation
- Auto-scroll with manual override
- Textarea with Shift+Enter for newlines
- Reconnection with exponential backoff
- Status indicator (connected/working/disconnected)

## API Reference

### List Sprites

```
GET /api/sprites
→ [{ id, name, cwd, status, lastActivity, url? }, ...]
```

### Get Sprite

```
GET /api/sprites/:id
→ { id, name, cwd, status, lastActivity, url? }
```

### Create Sprite

```
POST /api/sprites
Content-Type: application/json

{
  "name": "feature-auth",
  "cwd": "/path/to/project",
  "url": "https://optional-remote-url.fly.dev"  // optional
}
```

### Delete Sprite

```
DELETE /api/sprites/:id
→ { success: true }
```

### Update Status

```
PATCH /api/sprites/:id/status
Content-Type: application/json

{ "status": "idle" | "working" | "offline" }
```

### WebSocket

```
WS /api/sprites/:id/ws
```

**Client → Server:**
- `{ "type": "prompt", "payload": { "text": "..." } }` - Send prompt
- `{ "type": "abort" }` - Abort current operation

**Server → Client:**
- `{ "type": "connected", "spriteId": "..." }` - Connection established
- `{ "type": "agent_start" }` - Agent started processing
- `{ "type": "agent_end" }` - Agent finished
- `{ "type": "message_start", "message": {...} }` - New message
- `{ "type": "message_update", "assistantMessageEvent": {...} }` - Streaming delta
- `{ "type": "message_end" }` - Message complete
- `{ "type": "tool_execution_start", "toolName": "...", "params": {...} }`
- `{ "type": "tool_execution_end", "result": {...}, "isError": bool }`
- `{ "type": "error", "message": "..." }` - Error occurred

## Development

```bash
# Type check
bun run check

# Run QA tests
bun test/web/qa.ts
```

## Deployment

### On Hetzner/Homelab (via Tailscale)

```bash
# Install
git clone <this-repo>
cd cockpit
bun install

# Run dashboard
bun run src/web/cli.ts --port 3000 --data-dir ~/.pi/web-server
```

Access via `http://<tailscale-ip>:3000` from any device on your Tailscale network.

### With systemd

```ini
[Unit]
Description=Pi Web Dashboard
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/cockpit
ExecStart=/usr/local/bin/bun run src/web/cli.ts --port 3000 --data-dir /home/youruser/.pi/web-server
Restart=always

[Install]
WantedBy=multi-user.target
```

## File Structure

```
src/
├── cli.ts              # CLI entry point (Sprite helper)
└── web/
    ├── cli.ts          # Web dashboard entry point
    ├── index.ts        # Elysia server with routes
    ├── templates.ts    # Dashboard HTML templates
    ├── sprites.ts      # Sprite store (memory/file)
├── agent-bridge.ts  # WebSocket ↔ Agent session
└── agent-ui.ts      # Enhanced chat UI template
```

## License

MIT
