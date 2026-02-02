#!/usr/bin/env bun
/**
 * Simple QA test for pi-web-server (curl-based, no browser deps)
 * Run with: bun test/qa.ts
 */

const PORT = 3457;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
	console.log("🧪 Starting QA tests...\n");

	let passed = 0;
	let failed = 0;

	const parseJson = async (res: Response) => (await res.json()) as any;

	async function test(name: string, fn: () => Promise<void>) {
		try {
			await fn();
			console.log(`✅ ${name}`);
			passed++;
		} catch (err) {
			console.log(`❌ ${name}`);
			console.log(`   ${err}`);
			failed++;
		}
	}

	// Test 1: Dashboard loads with correct title
	await test("Dashboard loads with title", async () => {
		const res = await fetch(BASE_URL);
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const html = await res.text();
		if (!html.includes("<title>Pi Dashboard</title>")) throw new Error("Missing title");
	});

	// Test 2: Dashboard has header
	await test("Dashboard has header", async () => {
		const res = await fetch(BASE_URL);
		const html = await res.text();
		if (!html.includes("Pi Dashboard")) throw new Error("Missing header text");
		if (!html.includes("<h1>")) throw new Error("Missing h1 tag");
	});

	// Test 3: Dashboard has new sprite link
	await test("Dashboard has new sprite link", async () => {
		const res = await fetch(BASE_URL);
		const html = await res.text();
		if (!html.includes('href="/sprites/new"')) throw new Error("Missing new sprite link");
	});

	// Test 4: New sprite form loads
	await test("New sprite form loads", async () => {
		const res = await fetch(`${BASE_URL}/sprites/new`);
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const html = await res.text();
		if (!html.includes("<title>New Sprite - Pi</title>")) throw new Error("Wrong title");
		if (!html.includes('name="name"')) throw new Error("Missing name input");
		if (!html.includes('name="repo"')) throw new Error("Missing repo input");
	});

	// Test 5: API list sprites (empty initially)
	await test("API: List sprites returns array", async () => {
		const res = await fetch(`${BASE_URL}/api/sprites`);
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const data = await parseJson(res);
		if (!Array.isArray(data)) throw new Error("Not an array");
	});

	// Test 6: API create sprite
	await test("API: Create sprite", async () => {
		const uniqueName = `api-test-${Date.now()}`;
		const res = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: uniqueName, cwd: "/tmp/test" }),
		});
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const data = await parseJson(res);
		if (!data.id) throw new Error("No ID returned");
		if (data.name !== uniqueName) throw new Error(`Wrong name: ${data.name}`);
		if (data.status !== "idle") throw new Error(`Wrong status: ${data.status}`);
	});

	// Test 7: API get sprite
	await test("API: Get sprite", async () => {
		// Create first
		const createRes = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: `get-test-${Date.now()}`, cwd: "/tmp" }),
		});
		const created = await parseJson(createRes);

		// Get it
		const getRes = await fetch(`${BASE_URL}/api/sprites/${created.id}`);
		if (!getRes.ok) throw new Error(`Status ${getRes.status}`);
		const data = await parseJson(getRes);
		if (data.id !== created.id) throw new Error("ID mismatch");
	});

	// Test 8: API delete sprite
	await test("API: Delete sprite", async () => {
		// Create first
		const createRes = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: `delete-test-${Date.now()}`, cwd: "/tmp" }),
		});
		const created = await parseJson(createRes);

		// Delete
		const deleteRes = await fetch(`${BASE_URL}/api/sprites/${created.id}`, { method: "DELETE" });
		if (!deleteRes.ok) throw new Error(`Delete status ${deleteRes.status}`);

		// Verify gone
		const getRes = await fetch(`${BASE_URL}/api/sprites/${created.id}`);
		if (getRes.status !== 404) throw new Error(`Expected 404, got ${getRes.status}`);
	});

	// Test 9: API update status
	await test("API: Update sprite status", async () => {
		// Create first
		const createRes = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: `status-test-${Date.now()}`, cwd: "/tmp" }),
		});
		const created = await parseJson(createRes);

		// Update status
		const updateRes = await fetch(`${BASE_URL}/api/sprites/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "working" }),
		});
		if (!updateRes.ok) throw new Error(`Update status ${updateRes.status}`);

		// Verify
		const getRes = await fetch(`${BASE_URL}/api/sprites/${created.id}`);
		const data = await parseJson(getRes);
		if (data.status !== "working") throw new Error(`Status not updated: ${data.status}`);
	});

	// Test 10: Sprite view page loads
	await test("Sprite view page loads", async () => {
		// Create first
		const createRes = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: `view-test-${Date.now()}`, cwd: "/tmp" }),
		});
		const created = await parseJson(createRes);

		// Load view page
		const res = await fetch(`${BASE_URL}/sprites/${created.id}`);
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const html = await res.text();
		if (!html.includes("iframe")) throw new Error("Missing iframe");
		if (!html.includes(created.name)) throw new Error("Missing sprite name");
	});

	// Test 11: Agent UI page loads
	await test("Agent UI page loads", async () => {
		// Create first
		const createRes = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: `ui-test-${Date.now()}`, cwd: "/tmp" }),
		});
		const created = await parseJson(createRes);

		// Load UI page
		const res = await fetch(`${BASE_URL}/sprites/${created.id}/ui`);
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const html = await res.text();
		if (!html.includes('id="input"')) throw new Error("Missing input");
		if (!html.includes('id="send"')) throw new Error("Missing send button");
		if (!html.includes("WebSocket")) throw new Error("Missing WebSocket code");
	});

	// Test 12: 404 for non-existent sprite
	await test("404 for non-existent sprite", async () => {
		const res = await fetch(`${BASE_URL}/sprites/nonexistent123`);
		if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
		const html = await res.text();
		if (!html.includes("Sprite Not Found")) throw new Error("Missing error message");
	});

	// Test 13: Sprite appears in dashboard
	await test("Sprite appears in dashboard after creation", async () => {
		const uniqueName = `dashboard-test-${Date.now()}`;
		await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: uniqueName, cwd: "/tmp" }),
		});

		const res = await fetch(BASE_URL);
		const html = await res.text();
		if (!html.includes(uniqueName)) throw new Error("Sprite not in dashboard");
		if (!html.includes("sprite-card")) throw new Error("Missing sprite card");
	});

	// Test 14: Create sprite with URL (remote sprite)
	await test("API: Create remote sprite with URL", async () => {
		const uniqueName = `remote-test-${Date.now()}`;
		const res = await fetch(`${BASE_URL}/api/sprites`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: uniqueName,
				cwd: "/app",
				url: "https://sprite-abc.fly.dev",
			}),
		});
		if (!res.ok) throw new Error(`Status ${res.status}`);
		const data = await parseJson(res);
		if (data.url !== "https://sprite-abc.fly.dev") throw new Error("URL not saved");
	});

	// Test 15: Form POST creates sprite and redirects
	await test("Form POST creates sprite", async () => {
		const uniqueName = `form-test-${Date.now()}`;
		const res = await fetch(`${BASE_URL}/sprites/new`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `name=${encodeURIComponent(uniqueName)}&repo=${encodeURIComponent("https://github.com/badlogic/pi-mono")}`,
			redirect: "manual",
		});
		// Should redirect
		if (res.status !== 302 && res.status !== 303) {
			throw new Error(`Expected redirect, got ${res.status}`);
		}
		const location = res.headers.get("location");
		if (!location?.startsWith("/sprites/")) throw new Error(`Bad redirect: ${location}`);
	});

	console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
	return failed === 0;
}

// Main
const { spawn } = await import("child_process");
const path = await import("path");

const serverPath = path.join(import.meta.dir, "..", "src", "cli.ts");

console.log(`Starting server on port ${PORT}...`);
const server = spawn("bun", ["run", serverPath, "--port", String(PORT)], {
	stdio: ["ignore", "pipe", "pipe"],
});

// Wait for server to start
await new Promise<void>((resolve, reject) => {
	const timeout = setTimeout(() => reject(new Error("Server start timeout")), 5000);
	server.stdout?.on("data", (data) => {
		if (data.toString().includes("Pi Dashboard running")) {
			clearTimeout(timeout);
			resolve();
		}
	});
	server.stderr?.on("data", (data) => {
		console.error("Server error:", data.toString());
	});
});

console.log("Server started.\n");

try {
	const success = await runTests();
	server.kill();
	process.exit(success ? 0 : 1);
} catch (err) {
	console.error("Test error:", err);
	server.kill();
	process.exit(1);
}
