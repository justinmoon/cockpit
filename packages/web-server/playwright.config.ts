import { defineConfig } from "@playwright/test";

const baseURL = process.env.PI_WEB_BASE_URL || "http://localhost:3000";

export default defineConfig({
	testDir: "./test/e2e",
	fullyParallel: false,
	timeout: 300_000,
	expect: {
		timeout: 120_000,
	},
	use: {
		baseURL,
		headless: true,
		viewport: { width: 1280, height: 720 },
		trace: "on-first-retry",
	},
	reporter: [["list"]],
});
