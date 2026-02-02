/**
 * Pi Web Server
 *
 * Two modes:
 * 1. Dashboard mode (default): Lists and manages sprites
 * 2. Agent mode (--agent): Serves pi-web-ui connected to a local agent
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { html } from "@elysiajs/html";
import { Elysia } from "elysia";
import { type ClientMessage, handleAgentClose, handleClientMessage, setupAgentWebSocket } from "./agent-bridge";
import { agentUIPage } from "./agent-ui";
import { error, log, warn } from "./logger";
import { createSpriteStore, type SpriteStore } from "./sprites";
import { agentPage, dashboardPage, errorPage, newSpritePage, type SpriteInfo } from "./templates";

export interface ServerConfig {
	port: number;
	host: string;
	dataDir?: string;
}

export function createDashboardServer(config: ServerConfig) {
	const store = createSpriteStore(config.dataDir);

	const app = new Elysia()
		.use(html())
		// Dashboard home
		.get("/", async () => {
			const sprites = await store.list();
			return dashboardPage(sprites);
		})
		// New sprite form
		.get("/sprites/new", () => {
			return newSpritePage();
		})
		// Create sprite
		.post("/sprites/new", async ({ body, set }) => {
			const { name, repo, branch } = body as { name?: string; repo?: string; branch?: string };

			if (!name || !repo) {
				return newSpritePage("Name and git repository are required");
			}

			try {
				// Convert SSH URLs to HTTPS (e.g., git@github.com:user/repo.git -> https://github.com/user/repo.git)
				let httpsRepo = repo;
				if (repo.startsWith("git@")) {
					httpsRepo = `${repo.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "")}.git`;
				}

				// Extract repo name from URL for the directory
				const repoName =
					httpsRepo
						.split("/")
						.pop()
						?.replace(/\.git$/, "") || "repo";
				const workspaceDir = getWorkspaceDir();
				await ensureDir(workspaceDir);
				const cwd = `${workspaceDir}/${repoName}`;

				// Clone the repo using HTTPS
				const cloneCmd = branch
					? `git clone --branch ${branch} ${httpsRepo} ${cwd}`
					: `git clone ${httpsRepo} ${cwd}`;

				log(`git clone sprite=${name} repo=${httpsRepo} branch=${branch || "default"} cwd=${cwd}`);
				const proc = Bun.spawn(["sh", "-c", cloneCmd], {
					stdout: "pipe",
					stderr: "pipe",
				});

				const exitCode = await proc.exited;
				if (exitCode !== 0) {
					const stderr = await new Response(proc.stderr).text();
					// If directory exists, try to pull instead
					if (stderr.includes("already exists")) {
						log(`git pull sprite=${name} cwd=${cwd}`);
						const pullProc = Bun.spawn(["sh", "-c", `cd ${cwd} && git pull`], {
							stdout: "pipe",
							stderr: "pipe",
						});
						await pullProc.exited;
					} else {
						error(`git clone failed sprite=${name} repo=${httpsRepo} err=${stderr.trim()}`);
						throw new Error(`Git clone failed: ${stderr}`);
					}
				}

				const sprite = await store.create({ name, cwd, repo, branch });
				set.status = 302;
				set.headers.Location = `/sprites/${sprite.id}`;
				return "";
			} catch (err) {
				return newSpritePage(`Failed to create sprite: ${err}`);
			}
		})
		// View sprite (wrapper page with iframe)
		.get("/sprites/:id", async ({ params, set }) => {
			const sprite = await store.get(params.id);
			if (!sprite) {
				set.status = 404;
				return errorPage("Sprite Not Found", `No sprite with ID "${params.id}"`);
			}
			return agentPage(sprite);
		})
		// Sprite UI - serves the actual pi-web-ui
		// For remote sprites, this would proxy to the sprite's URL
		// For local sprites, this serves the embedded UI
		.get("/sprites/:id/ui", async ({ params, set }) => {
			const sprite = await store.get(params.id);
			if (!sprite) {
				set.status = 404;
				return errorPage("Sprite Not Found", `No sprite with ID "${params.id}"`);
			}

			// If sprite has a URL, redirect to it
			if (sprite.url) {
				set.status = 302;
				set.headers.Location = sprite.url;
				return "";
			}

			// Enhanced chat UI with WebSocket connection to server-side agent
			return agentUIPage(sprite);
		})
		// Delete sprite
		.post("/sprites/:id/delete", async ({ params, set }) => {
			await store.delete(params.id);
			set.status = 302;
			set.headers.Location = "/";
			return "";
		})
		// API endpoints for programmatic access
		.get("/api/sprites", async () => {
			return await store.list();
		})
		.get("/api/sprites/:id", async ({ params, set }) => {
			const sprite = await store.get(params.id);
			if (!sprite) {
				set.status = 404;
				return { error: "Sprite not found" };
			}
			return sprite;
		})
		.post("/api/sprites", async ({ body }) => {
			const { name, cwd, repo, branch, url } = body as {
				name: string;
				cwd?: string;
				repo?: string;
				branch?: string;
				url?: string;
			};

			let finalCwd = cwd;

			// If repo provided, clone it
			if (repo && !cwd) {
				let httpsRepo = repo;
				if (repo.startsWith("git@")) {
					httpsRepo = `${repo.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "")}.git`;
				}

				const repoName =
					httpsRepo
						.split("/")
						.pop()
						?.replace(/\.git$/, "") || "repo";
				const workspaceDir = getWorkspaceDir();
				await ensureDir(workspaceDir);
				finalCwd = `${workspaceDir}/${repoName}`;

				const cloneCmd = branch
					? `git clone --branch ${branch} ${httpsRepo} ${finalCwd}`
					: `git clone ${httpsRepo} ${finalCwd}`;

				log(`api git clone sprite=${name} repo=${httpsRepo} branch=${branch || "default"} cwd=${finalCwd}`);
				const proc = Bun.spawn(["sh", "-c", cloneCmd], {
					stdout: "pipe",
					stderr: "pipe",
				});

				const exitCode = await proc.exited;
				if (exitCode !== 0) {
					const stderr = await new Response(proc.stderr).text();
					if (!stderr.includes("already exists")) {
						error(`api git clone failed sprite=${name} repo=${httpsRepo} err=${stderr.trim()}`);
						throw new Error(`Git clone failed: ${stderr}`);
					}
				}
			}

			if (!finalCwd) {
				throw new Error("Either cwd or repo is required");
			}

			return await store.create({ name, cwd: finalCwd, repo, branch, url });
		})
		.delete("/api/sprites/:id", async ({ params }) => {
			await store.delete(params.id);
			return { success: true };
		})
		.patch("/api/sprites/:id/status", async ({ params, body }) => {
			const { status } = body as { status: SpriteInfo["status"] };
			await store.updateStatus(params.id, status);
			return { success: true };
		})
		// WebSocket for agent communication
		.ws("/api/sprites/:id/ws", {
			open(ws) {
				const spriteId = (ws.data as unknown as { params: { id: string } }).params.id;
				// Store on ws.data for later retrieval
				(ws.data as any).spriteId = spriteId;
				log(`ws open sprite=${spriteId}`);
					store.get(spriteId).then((sprite: SpriteInfo | null) => {
						if (sprite) {
							setupAgentWebSocket(ws as any, sprite);
							store.updateStatus(spriteId, "working");
						} else {
						ws.send(JSON.stringify({ type: "error", message: "Sprite not found" }));
						ws.close();
					}
				});
			},
			message(ws, message) {
				const spriteId = (ws.data as any).spriteId || (ws.data as any).params?.id;
				let parsed: ClientMessage | null = null;

				// If Elysia already parsed JSON, message will be an object
				if (message && typeof message === "object" && "type" in (message as any)) {
					parsed = message as ClientMessage;
				} else {
					const raw = decodeWsMessage(message);
					if (!raw) {
						const ctor = (message as any)?.constructor?.name || "unknown";
						const tag = Object.prototype.toString.call(message);
						const keys = Object.keys(message as any).join(",");
						const hasData = message && typeof message === "object" && "data" in (message as any);
						ws.send(JSON.stringify({ type: "error", message: "Invalid WebSocket message" }));
						warn(
							`ws invalid message sprite=${spriteId} type=${typeof message} ctor=${ctor} tag=${tag} keys=[${keys}] hasData=${hasData}`,
						);
						return;
					}

					try {
						parsed = JSON.parse(raw) as ClientMessage;
					} catch (err) {
						ws.send(JSON.stringify({ type: "error", message: `Invalid message: ${err}` }));
						warn(`ws JSON parse error sprite=${spriteId} raw=${raw}`);
						return;
					}
				}

				if (!parsed) {
					ws.send(JSON.stringify({ type: "error", message: "Invalid WebSocket message" }));
					return;
				}

				log(`ws message sprite=${spriteId} type=${parsed.type}`);

					void handleClientMessage(spriteId, parsed, (msg: string) => {
						ws.send(JSON.stringify({ type: "error", message: msg }));
					});
				},
			close(ws) {
				const spriteId = (ws.data as any).spriteId || (ws.data as any).params?.id;
				if (spriteId) {
					log(`ws close sprite=${spriteId}`);
					handleAgentClose(spriteId);
					store.updateStatus(spriteId, "idle");
				}
			},
		});

	return {
		app,
		store,
		start: () => {
			app.listen({
				port: config.port,
				hostname: config.host,
			});
			log(`Pi Dashboard running at http://${config.host}:${config.port}`);
			return app;
		},
	};
}

function getWorkspaceDir(): string {
	const envDir = process.env.PI_WORKSPACE_DIR || process.env.SPRITE_WORKSPACE_DIR || process.env.SPRITE_WORKSPACE;

	if (envDir) return envDir;
	if (process.env.HOME) return path.join(process.env.HOME, "workspace");
	return process.cwd();
}

async function ensureDir(dir: string) {
	try {
		await mkdir(dir, { recursive: true });
	} catch (_err) {
		// Ignore if it already exists
	}
}

function decodeWsMessage(message: unknown): string | null {
	if (typeof message === "string") return message;
	if (message instanceof ArrayBuffer) {
		return new TextDecoder().decode(message);
	}
	if (message instanceof Uint8Array) {
		return new TextDecoder().decode(message);
	}
	if (typeof message === "object" && message && "data" in message) {
		// Some adapters wrap the payload in a { data } object
		return decodeWsMessage((message as { data?: unknown }).data);
	}
	return null;
}

export type { SpriteInfo, SpriteStore };
