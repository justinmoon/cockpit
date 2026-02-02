#!/usr/bin/env bun
/**
 * Pi Web Server CLI
 *
 * Usage:
 *   cockpit-web                     # Start dashboard on default port
 *   cockpit-web --port 8080         # Custom port
 *   cockpit-web --data-dir ./data   # Persist sprite data to directory
 */

import { parseArgs } from "util";
import { createDashboardServer } from "./index";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		port: {
			type: "string",
			short: "p",
			default: "3000",
		},
		host: {
			type: "string",
			short: "h",
			default: "0.0.0.0",
		},
		"data-dir": {
			type: "string",
			short: "d",
		},
		help: {
			type: "boolean",
		},
	},
	allowPositionals: false,
});

if (values.help) {
	console.log(`
Cockpit Web - Dashboard for managing coding agent sprites

Usage:
  cockpit-web [options]

Options:
  -p, --port <port>       Port to listen on (default: 3000)
  -h, --host <host>       Host to bind to (default: 0.0.0.0)
  -d, --data-dir <dir>    Directory for persistent data (sprites.json)
      --help              Show this help message

Examples:
  cockpit-web                     # Start on http://0.0.0.0:3000
  cockpit-web -p 8080             # Start on port 8080
  cockpit-web -d ~/.pi/web-server # Persist sprite data

The dashboard lets you manage multiple pi coding agent sessions (sprites).
Each sprite can be:
  - A local agent session (runs in-process)
  - A remote sprite (Fly.io VM) with its own pi-web-ui
`);
	process.exit(0);
}

const server = createDashboardServer({
	port: parseInt(values.port!, 10),
	host: values.host!,
	dataDir: values["data-dir"],
});

server.start();
