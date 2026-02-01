#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

type RunOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe" | "ignore";
  input?: string;
};

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  return {
    help: flags.has("--help") || flags.has("-h"),
    dryRun: flags.has("--dry-run"),
  };
}

function nowStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function sanitizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

async function pathExists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function spawnPromise(
  cmd: string,
  args: string[],
  opts: RunOpts & { dryRun?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { cwd, env, stdio = "inherit", input, dryRun } = opts;

  const printable = [cmd, ...args].map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ");
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] ${printable}`);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: stdio === "inherit" ? "inherit" : stdio === "ignore" ? "ignore" : "pipe",
    });

    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (d) => (stdout += String(d)));
    if (child.stderr) child.stderr.on("data", (d) => (stderr += String(d)));

    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));

    if (input != null && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function runOk(
  cmd: string,
  args: string[],
  opts: RunOpts & { dryRun?: boolean; allowFailure?: boolean } = {},
) {
  const { allowFailure, ...rest } = opts;
  const res = await spawnPromise(cmd, args, rest);
  if (!allowFailure && res.code !== 0) {
    const suffix = res.stdout || res.stderr ? `\n\n${res.stdout}${res.stderr}` : "";
    throw new Error(`Command failed (${res.code}): ${cmd} ${args.join(" ")}${suffix}`);
  }
  return res;
}

async function getRepoUrlFromCwd(dryRun: boolean): Promise<string | null> {
  const inside = await spawnPromise("git", ["rev-parse", "--is-inside-work-tree"], {
    stdio: "pipe",
    dryRun,
  });
  if (inside.code !== 0) return null;
  const url = await spawnPromise("git", ["remote", "get-url", "origin"], { stdio: "pipe", dryRun });
  if (url.code !== 0) return null;
  const v = url.stdout.trim();
  return v ? v : null;
}

async function promptForRepoUrl(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const v = (await rl.question("Repo URL to clone in the Sprite (master): ")).trim();
    if (!v) throw new Error("Missing repo URL");
    return v;
  } finally {
    rl.close();
  }
}

function spriteArgsBase(org?: string) {
  return org ? ["-o", org] : [];
}

function spriteScopedArgs(spriteName: string, org?: string) {
  return [...spriteArgsBase(org), "-s", spriteName];
}

function remoteBootstrapScript(nodeVersion: string) {
  // Keep this intentionally simple and self-contained: install minimum deps, then Node from upstream tarball.
  // We avoid distro-specific Node packages because they might be <20.
  return String.raw`
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y git curl ca-certificates tar xz-utils bash
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git curl ca-certificates tar xz bash
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git curl ca-certificates tar xz bash
  else
    echo "Unsupported base image: missing package manager (need git/curl/tar/xz)" >&2
    exit 1
  fi
fi

mkdir -p /usr/local/bin /opt

if command -v node >/dev/null 2>&1; then
  v="$(node -p 'process.versions.node' 2>/dev/null || true)"
  major="\${v%%.*}"
  if [ -n "$major" ] && [ "$major" -ge 20 ]; then
    echo "node already present: v$v"
  else
    echo "node present but too old (v$v); installing v${nodeVersion}"
    rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx >/dev/null 2>&1 || true
  fi
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(\".\")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *)
      echo "Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac

  node_dir="/opt/node-v${nodeVersion}"
  if [ ! -x "$node_dir/bin/node" ]; then
    echo "Downloading Node v${nodeVersion}..."
    rm -f /tmp/node.tar.xz
    curl -fsSL --retry 3 --retry-delay 1 --retry-connrefused "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-\${node_arch}.tar.xz" -o /tmp/node.tar.xz
    mkdir -p "$node_dir"
    if command -v xz >/dev/null 2>&1; then
      xz -dc /tmp/node.tar.xz | tar -x -C "$node_dir" --strip-components=1
    else
      echo "Missing xz; cannot extract node tarball" >&2
      exit 1
    fi
    rm -f /tmp/node.tar.xz
  fi

  ln -sf "$node_dir/bin/node" /usr/local/bin/node
  ln -sf "$node_dir/bin/npm" /usr/local/bin/npm
  ln -sf "$node_dir/bin/npx" /usr/local/bin/npx
fi

node -v
npm -v

if ! command -v pi >/dev/null 2>&1; then
  npm config set fund false >/dev/null 2>&1 || true
  npm config set audit false >/dev/null 2>&1 || true
  npm install -g @mariozechner/pi-coding-agent
fi

pi --version || true
`;
}

function remoteCloneScript(repoUrl: string, branch: string) {
  const repo = repoUrl.replaceAll("'", "'\\''");
  const b = branch.replaceAll("'", "'\\''");
  return String.raw`
set -euo pipefail

rm -rf /workspace
mkdir -p /workspace

echo "Cloning ${repoUrl}..."
if git clone --depth 1 --branch '${b}' '${repo}' /workspace >/tmp/cockpit-git-clone.log 2>&1; then
  echo "Checked out branch '${branch}'."
else
  echo "WARN: clone --branch '${branch}' failed; cloning default branch instead." >&2
  cat /tmp/cockpit-git-clone.log >&2 || true
  rm -rf /workspace
  git clone --depth 1 '${repo}' /workspace
fi
`;
}

async function tarDirectory(srcDir: string, dryRun: boolean): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `cockpit-${process.pid}-${Date.now()}.tar.gz`);
  await runOk("tar", ["-czf", tmpPath, "-C", path.dirname(srcDir), path.basename(srcDir)], {
    stdio: "inherit",
    dryRun,
  });
  return tmpPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "cockpit - run pi inside a Fly Sprite",
        "",
        "Usage:",
        "  cockpit",
        "",
        "Env:",
        "  COCKPIT_REPO_URL        Repo URL to clone (default: current dir origin remote)",
        "  COCKPIT_BRANCH         Branch to checkout (default: master)",
        "  COCKPIT_SPRITE_ORG      Fly org name (optional)",
        "  COCKPIT_NODE_VERSION    Node version for Sprite install (default: 20.11.1)",
        "",
        "Debug:",
        "  cockpit --dry-run       Print commands without running them",
      ].join("\n"),
    );
    return;
  }

  const dryRun = args.dryRun || process.env.COCKPIT_DRY_RUN === "1";
  const org = process.env.COCKPIT_SPRITE_ORG;
  const branch = process.env.COCKPIT_BRANCH?.trim() || "master";
  const nodeVersion = process.env.COCKPIT_NODE_VERSION?.trim() || "20.11.1";

  const spriteCmd = process.env.SPRITE_BIN?.trim() || "sprite";

  let repoUrl = process.env.COCKPIT_REPO_URL?.trim() || "";
  if (!repoUrl) {
    const detected = await getRepoUrlFromCwd(dryRun);
    if (detected) repoUrl = detected;
  }
  if (!repoUrl) {
    repoUrl = await promptForRepoUrl();
  }

  const spriteName = sanitizeName(`cockpit-${nowStamp()}`);

  // Ensure sprite auth. Keep it simple: try `org list`, otherwise `login`.
  const authCheck = await spawnPromise(spriteCmd, [...spriteArgsBase(org), "org", "list"], {
    stdio: "ignore",
    dryRun,
  });
  if (authCheck.code !== 0) {
    await runOk(spriteCmd, [...spriteArgsBase(org), "login"], { stdio: "inherit", dryRun });
  }

  // Create the sprite.
  await runOk(spriteCmd, [...spriteArgsBase(org), "create", spriteName], { stdio: "inherit", dryRun });

  let activeChild: ReturnType<typeof spawn> | null = null;
  let cleaningUp = false;

  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    if (activeChild && !activeChild.killed) {
      try {
        activeChild.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    await runOk(spriteCmd, [...spriteScopedArgs(spriteName, org), "destroy"], {
      stdio: "inherit",
      dryRun,
      allowFailure: true,
    });
  };

  const handleSignal = (sig: NodeJS.Signals) => {
    void (async () => {
      if (activeChild && !activeChild.killed) {
        try {
          activeChild.kill(sig);
        } catch {
          // ignore
        }
      }
      await cleanup();
      process.exit(128 + (sig === "SIGINT" ? 2 : 15));
    })();
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  try {
    // Bootstrap tools + pi.
    await runOk(
      spriteCmd,
      [
        ...spriteScopedArgs(spriteName, org),
        "exec",
        "/bin/sh",
        "-lc",
        remoteBootstrapScript(nodeVersion),
      ],
      { stdio: "inherit", dryRun },
    );

    // Clone repo into /workspace (master preferred).
    await runOk(
      spriteCmd,
      [...spriteScopedArgs(spriteName, org), "exec", "/bin/sh", "-lc", remoteCloneScript(repoUrl, branch)],
      { stdio: "inherit", dryRun },
    );

    // Copy ~/.pi into /root/.pi in the sprite (best-effort).
    const hostPiDir = path.join(os.homedir(), ".pi");
    if (await pathExists(hostPiDir)) {
      const tarPath = await tarDirectory(hostPiDir, dryRun);
      try {
        await runOk(
          spriteCmd,
          [
            ...spriteScopedArgs(spriteName, org),
            "exec",
            "-file",
            `${tarPath}:/tmp/host-pi.tar.gz`,
            "/bin/sh",
            "-lc",
            "mkdir -p /root && tar -xzf /tmp/host-pi.tar.gz -C /root && rm -f /tmp/host-pi.tar.gz",
          ],
          { stdio: "inherit", dryRun },
        );
      } finally {
        if (!dryRun) {
          await fs.rm(tarPath, { force: true });
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`Note: ${hostPiDir} not found; skipping pi config sync.`);
    }

    // Run pi in a TTY inside the sprite.
    const piArgs = [
      ...spriteScopedArgs(spriteName, org),
      "exec",
      "-tty",
      "-dir",
      "/workspace",
      "pi",
    ];
    if (dryRun) {
      await runOk(spriteCmd, piArgs, { stdio: "inherit", dryRun });
      return;
    }

    activeChild = spawn(spriteCmd, piArgs, { stdio: "inherit" });
    const exitCode: number = await new Promise((resolve) =>
      activeChild!.on("close", (code) => resolve(code ?? 0)),
    );

    if (exitCode !== 0) {
      throw new Error(`pi exited with code ${exitCode}`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
