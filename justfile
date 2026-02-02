# CI/automation should run under nix develop.
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Check for nix shell
[private]
nix-check:
    @test -n "$IN_NIX_SHELL" || (echo "Run 'nix develop' first" && exit 1)

# Pre-merge checks (lint/typecheck, etc.)
pre-merge: nix-check
    bun install --frozen-lockfile
    bun run check

# CLI (Sprite helper)
cli *args:
    bun run src/cli.ts {{args}}

# Web dashboard (local)
web *args:
    bun run src/web/cli.ts {{args}}

install:
    @bun remove -g cockpit >/dev/null 2>&1 || true
    @bun add -g "file:$(pwd)"
    @echo "cockpit -> $(command -v cockpit 2>/dev/null || echo not-found)"
    @echo "cockpit-web -> $(command -v cockpit-web 2>/dev/null || echo not-found)"
    @echo "Ensure global Bun bin is on PATH: $(bun pm bin -g)"

uninstall:
    @bun remove -g cockpit

check:
    bun run check
