#!/usr/bin/env bun
/**
 * WebSocket smoke test for pi-web-server
 *
 * Usage:
 *   bun test/ws-smoke.ts
 */

const baseUrl = "http://localhost:3000";

async function main() {
	console.log("Creating sprite...");
	const createRes = await fetch(`${baseUrl}/api/sprites`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: `ws-smoke-${Date.now()}`, cwd: "/tmp" }),
	});

	if (!createRes.ok) {
		console.error("Failed to create sprite:", await createRes.text());
		process.exit(1);
	}

	const sprite = (await createRes.json()) as any;
	console.log("Sprite created:", sprite.id);

	const wsUrl = `${baseUrl.replace("http", "ws")}/api/sprites/${sprite.id}/ws`;
	console.log("Connecting to", wsUrl);

	const ws = new WebSocket(wsUrl);
	let gotAnyMessage = false;

	ws.onopen = () => {
		console.log("WS connected, sending prompt...");
		ws.send(JSON.stringify({ type: "prompt", payload: { text: "Hello from ws-smoke" } }));
		// Safety timeout
		setTimeout(() => {
			console.log("Timeout, closing WS...");
			ws.close();
		}, 10000);
	};

	ws.onmessage = (event) => {
		gotAnyMessage = true;
		try {
			const msg = JSON.parse(event.data);
			console.log("WS event:", msg.type || msg);
			if (msg.type === "error") {
				console.log("WS error message:", msg.message);
			}
			if (msg.type === "agent_end") {
				console.log("Agent finished, closing...");
				ws.close();
			}
		} catch (_err) {
			console.error("Failed to parse WS message:", event.data);
		}
	};

	ws.onclose = () => {
		console.log("WS closed");
		process.exit(gotAnyMessage ? 0 : 1);
	};

	ws.onerror = (err) => {
		console.error("WS error", err);
	};
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
