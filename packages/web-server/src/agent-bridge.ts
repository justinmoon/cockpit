/**
 * Agent Bridge - connects web clients to pi agent sessions via WebSocket
 *
 * For local sprites: spawns a pi agent in-process
 * For remote sprites: proxies WebSocket to the sprite's URL
 */

import { type AgentSession, codingTools, createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { log } from "./logger.js";
import type { SpriteInfo } from "./templates.js";

export interface AgentConnection {
	session: AgentSession;
	unsubscribe: () => void;
}

const activeConnections = new Map<string, AgentConnection>();

/**
 * Creates or retrieves an agent session for a sprite
 */
export async function getOrCreateAgent(sprite: SpriteInfo): Promise<AgentConnection> {
	const existing = activeConnections.get(sprite.id);
	if (existing) {
		return existing;
	}

	const { session } = await createAgentSession({
		cwd: sprite.cwd,
		sessionManager: SessionManager.create(sprite.cwd),
		tools: codingTools,
	});

	const connection: AgentConnection = {
		session,
		unsubscribe: () => {},
	};

	activeConnections.set(sprite.id, connection);
	return connection;
}

/**
 * Handles WebSocket messages from the client
 */
export interface ClientMessage {
	type: "prompt" | "abort";
	payload?: {
		text?: string;
	};
}

export interface WSEvent {
	type: string;
	[key: string]: unknown;
}

interface WebSocketLike {
	send(data: string): void;
}

/**
 * Sets up WebSocket handlers for agent communication
 */
export function setupAgentWebSocket(ws: WebSocketLike, sprite: SpriteInfo) {
	const send = (event: WSEvent) => {
		try {
			ws.send(JSON.stringify(event));
		} catch {
			// Client disconnected
		}
	};

	getOrCreateAgent(sprite)
		.then((connection) => {
			// Subscribe to agent events and forward to WebSocket
			const unsubscribe = connection.session.subscribe((event) => {
				send(event as WSEvent);
			});

			connection.unsubscribe = unsubscribe;

			send({ type: "connected", spriteId: sprite.id });
		})
		.catch((err) => {
			send({ type: "error", message: String(err) });
		});
}

export async function handleClientMessage(spriteId: string, msg: ClientMessage, sendError: (message: string) => void) {
	const connection = activeConnections.get(spriteId);

	if (!connection) {
		sendError("No active session");
		return;
	}

	switch (msg.type) {
		case "prompt":
			if (msg.payload?.text) {
				log(`agent prompt sprite=${spriteId} text=${msg.payload.text.slice(0, 80)}`);
				connection.session.prompt(msg.payload.text).catch((err) => {
					sendError(String(err));
				});
			}
			break;

		case "abort":
			log(`agent abort sprite=${spriteId}`);
			connection.session.abort();
			break;
	}
}

export function handleAgentClose(spriteId?: string) {
	if (!spriteId) return;

	const connection = activeConnections.get(spriteId);
	if (connection) {
		connection.unsubscribe();
		// Keep the session alive for reconnection
		// To fully clean up: activeConnections.delete(spriteId);
	}
}

/**
 * Cleans up an agent session completely
 */
export function disposeAgent(spriteId: string) {
	const connection = activeConnections.get(spriteId);
	if (connection) {
		connection.unsubscribe();
		connection.session.dispose();
		activeConnections.delete(spriteId);
	}
}
