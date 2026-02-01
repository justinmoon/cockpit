# cockpit

Minimal CLI to run the `pi` coding agent inside a Fly.io Sprite.

## Quick start

```sh
npm install
npm run build
npm link
cockpit
```

## Configuration

- `COCKPIT_REPO_URL`: repo URL to clone into `/workspace` (default: current dir `origin` remote)
- `COCKPIT_BRANCH`: branch to checkout (default: `master`)
- `COCKPIT_SPRITE_ORG`: Fly org name (optional)

## Notes

- `~/.pi` is copied to `$HOME/.pi` in the Sprite (best-effort), excluding `.pi/agent/bin` (host-specific binaries).
- If `COCKPIT_REPO_URL` is an SSH URL (e.g. `git@...`), `~/.ssh` is copied into the Sprite (best-effort).
- The Sprite is destroyed when you exit the shell (or on Ctrl+C).
