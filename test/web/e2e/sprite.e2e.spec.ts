import { expect, test } from "@playwright/test";

const repo = process.env.PI_TEST_REPO || "https://github.com/badlogic/pi-mono";
const branch = process.env.PI_TEST_BRANCH || "";

const uniqueName = () => `e2e-${Date.now().toString(36)}`;

test.describe("Pi Web Server E2E", () => {
	test("create sprite and get LLM response", async ({ page }) => {
		test.setTimeout(300_000);

		page.on("console", (msg) => {
			// Forward browser console logs to test output
			console.log(`[browser:${msg.type()}] ${msg.text()}`);
		});

		// Open dashboard
		await page.goto("/");
		await expect(page).toHaveTitle(/Pi Dashboard/i);

		// Go to new sprite page
		await page.click('a[href="/sprites/new"]');
		await expect(page).toHaveTitle(/New Sprite/i);

		// Fill form
		const spriteName = uniqueName();
		await page.fill('input[name="name"]', spriteName);
		await page.fill('input[name="repo"]', repo);
		if (branch) {
			await page.fill('input[name="branch"]', branch);
		}

		// Submit
		await page.click('button[type="submit"]');

		// Wait for sprite page
		await page.waitForURL(/\/sprites\/[a-z0-9]+$/);
		await expect(page.locator("body")).toContainText(spriteName);

		// Wait for iframe to load
		const frameLocator = page.frameLocator("#agent-frame");
		const input = frameLocator.locator("textarea#input");
		await expect(input).toBeVisible();
		await expect(input).toBeEnabled({ timeout: 120_000 });

		// Send message
		const userMessage = "Reply with exactly: pong";
		await input.fill(userMessage);
		await frameLocator.locator("button#send").click();

		// Wait for assistant response containing "pong"
		const assistant = frameLocator.locator(".message.assistant").last();
		await expect(assistant).toContainText(/pong/i, { timeout: 180_000 });
	});
});
