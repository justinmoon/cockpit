# Playwright E2E Tests

These tests exercise the full flow:
1. Open the dashboard
2. Create a new sprite (clone repo)
3. Open the embedded agent UI
4. Send a prompt and verify LLM response

## Prerequisites

- Server running (in the sprite) on port 3000
- `sprite proxy 3000` running on your Mac
- API keys configured in the sprite (`/login` in pi or env vars)

## Run

```bash
# On your Mac (or any machine with Playwright deps)
cd packages/web-server
npx playwright install --with-deps

# Ensure proxy is running
sprite proxy 3000 -s <sprite-name>

# Run test
PI_WEB_BASE_URL=http://localhost:3000 \
PI_TEST_REPO=https://github.com/badlogic/pi-mono \
PI_TEST_BRANCH=main \
npx playwright test
```

## Notes

- If you want a smaller repo, set `PI_TEST_REPO`
- If inference is slow, increase timeouts in `playwright.config.ts`
