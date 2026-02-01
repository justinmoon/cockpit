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
- `COCKPIT_NODE_VERSION`: Node version to install in the Sprite (default: `20.11.1`)

## Notes

- `~/.pi` is copied to `/root/.pi` in the Sprite (best-effort).
- The Sprite is destroyed when `pi` exits or on Ctrl+C.

