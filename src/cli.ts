#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

type RunOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe" | "ignore";
  input?: string;
};

let tmpCounter = 0;

function isInTmux(): boolean {
  return !!process.env.TMUX;
}

async function getTmuxWindowSprite(): Promise<string | null> {
  if (!isInTmux()) return null;
  // Use tmux window option instead of environment variable (broader tmux version support)
  const res = await spawnPromise("tmux", ["show-option", "-wqv", "@cockpit_sprite"], {
    stdio: "pipe",
  });
  if (res.code !== 0) return null;
  const value = res.stdout.trim();
  return value || null;
}

async function setTmuxWindowSprite(spriteName: string, dryRun: boolean): Promise<void> {
  if (!isInTmux()) return;
  const res = await spawnPromise("tmux", ["set-option", "-w", "@cockpit_sprite", spriteName], {
    stdio: "inherit",
    dryRun,
  });
  if (res.code !== 0) {
    throw new Error(`tmux set-option failed (${res.code})`);
  }
}

async function clearTmuxWindowSprite(dryRun: boolean): Promise<void> {
  if (!isInTmux()) return;
  const res = await spawnPromise("tmux", ["set-option", "-wu", "@cockpit_sprite"], {
    stdio: "inherit",
    dryRun,
  });
  if (res.code !== 0) {
    throw new Error(`tmux set-option -u failed (${res.code})`);
  }
}

async function warnIfDistLooksStale() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(here, "cli.js");
    const srcPath = path.join(here, "..", "src", "cli.ts");
    const [distStat, srcStat] = await Promise.all([fs.stat(distPath), fs.stat(srcPath)]);
    if (srcStat.mtimeMs > distStat.mtimeMs + 1000) {
      // eslint-disable-next-line no-console
      console.log("Note: `src/cli.ts` is newer than `dist/cli.js`. Run `npm run build` to rebuild.");
    }
  } catch {
    // ignore (likely running from installed package without src/)
  }
}

const COCKPIT_GITHUB_KEY_PATH = path.join(os.homedir(), ".ssh", "cockpit_github_ed25519");
const COCKPIT_GITHUB_KEY_PUB_PATH = `${COCKPIT_GITHUB_KEY_PATH}.pub`;
const COCKPIT_GITHUB_KEY_COMMENT_PREFIX = "cockpit:sprite-github:";

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const positional = argv.filter((a) => !a.startsWith("-"));
  const subcommand = positional[0] || "create"; // default to create
  return {
    subcommand,
    help: flags.has("--help") || flags.has("-h"),
    dryRun: flags.has("--dry-run"),
    qa: flags.has("--qa"),
    qaTurn: flags.has("--qa-turn"),
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

function parseAuthorizedKeyLine(line: string): { type: string; key: string; comment: string } {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) throw new Error("Invalid public key format");
  const [type, key, ...rest] = parts;
  return { type, key, comment: rest.join(" ") };
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

type SpriteExistence = "yes" | "no" | "unknown";

async function probeSpriteExistence(
  spriteCmd: string,
  spriteName: string,
  org: string | undefined,
  dryRun: boolean,
): Promise<{ existence: SpriteExistence; detail: string }> {
  if (dryRun) return { existence: "yes", detail: "" };
  const res = await spawnPromise(spriteCmd, [...spriteScopedArgs(spriteName, org), "exec", "/bin/sh", "-c", "true"], {
    stdio: "pipe",
  });
  if (res.code === 0) return { existence: "yes", detail: "" };
  const detail = (res.stdout + res.stderr).trim();
  const lower = detail.toLowerCase();
  if (lower.includes("sprite not found") || lower.includes("no such sprite")) {
    return { existence: "no", detail };
  }
  return { existence: "unknown", detail };
}

function remoteBootstrapScript() {
  // Sprite already includes node/npm. Keep setup minimal.
  // Key gotcha: `npm install -g` installs into `$(npm prefix -g)/bin`, which is NOT on PATH by default.
  return String.raw`
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Missing node in Sprite environment" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Missing npm in Sprite environment" >&2
  exit 1
fi

node -v
npm -v

if [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo "Node too old; need >= 20" >&2
  exit 1
fi

npm config set fund false >/dev/null 2>&1 || true
npm config set audit false >/dev/null 2>&1 || true
npm install -g @mariozechner/pi-coding-agent >/tmp/cockpit-npm-install.log 2>&1 || (cat /tmp/cockpit-npm-install.log >&2; exit 1)

export PATH="$(npm prefix -g)/bin:$PATH"
pi --version
`;
}

function remoteCloneScript(repoUrl: string, branch: string, remoteWorkDir: string, gitSshCommand: string) {
  const repo = repoUrl.replaceAll("'", "'\\''");
  const b = branch.replaceAll("'", "'\\''");
  const dir = remoteWorkDir.replaceAll("'", "'\\''");
  const parent = path.posix.dirname(remoteWorkDir).replaceAll("'", "'\\''");
  const sshCmd = gitSshCommand.replaceAll("'", "'\\''");
  return String.raw`
set -eu

if [ -n '${sshCmd}' ]; then
  export GIT_SSH_COMMAND='${sshCmd}'
fi

rm -rf '${dir}'
mkdir -p '${parent}'

echo "Cloning ${repoUrl}..."
if git clone --depth 1 --branch '${b}' '${repo}' '${dir}' >/tmp/cockpit-git-clone.log 2>&1; then
  echo "Checked out branch '${branch}'."
else
  echo "WARN: clone --branch '${branch}' failed; cloning default branch instead." >&2
  cat /tmp/cockpit-git-clone.log >&2 || true
  rm -rf '${dir}'
  git clone --depth 1 '${repo}' '${dir}'
fi
`;
}

function newTmpTarPath() {
  tmpCounter += 1;
  return path.join(os.tmpdir(), `cockpit-${process.pid}-${Date.now()}-${tmpCounter}.tar.gz`);
}

async function tarDirectory(srcDir: string, dryRun: boolean): Promise<string> {
  const tmpPath = newTmpTarPath();
  await runOk("tar", ["-czf", tmpPath, "--format", "ustar", "-C", path.dirname(srcDir), path.basename(srcDir)], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    dryRun,
  });
  return tmpPath;
}

async function tarDirectoryWithExcludes(srcDir: string, excludes: string[], dryRun: boolean): Promise<string> {
  const tmpPath = newTmpTarPath();
  const excludeArgs = excludes.flatMap((p) => ["--exclude", p]);
  await runOk("tar", [...excludeArgs, "-czf", tmpPath, "--format", "ustar", "-C", path.dirname(srcDir), path.basename(srcDir)], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    dryRun,
  });
  return tmpPath;
}

async function getRemoteHome(spriteCmd: string, spriteName: string, org: string | undefined, dryRun: boolean) {
  const res = await spawnPromise(
    spriteCmd,
    [...spriteScopedArgs(spriteName, org), "exec", "/bin/sh", "-c", 'printf "%s" "${HOME:-}"'],
    { stdio: "pipe", dryRun },
  );
  const v = res.stdout.trim();
  if (v) return v;
  return "/home/sprite";
}

function repoNeedsSsh(repoUrl: string) {
  return repoUrl.startsWith("git@") || repoUrl.startsWith("ssh://");
}

async function uploadAndExtractTarball(
  spriteCmd: string,
  spriteName: string,
  org: string | undefined,
  tarPath: string,
  remoteTmp: string,
  dryRun: boolean,
) {
  await runOk(
    spriteCmd,
    [
      ...spriteScopedArgs(spriteName, org),
      "exec",
      "-file",
      `${tarPath}:${remoteTmp}`,
      "/bin/sh",
      "-c",
      `tar -xzf ${remoteTmp} -C "\${HOME:-/home/sprite}" && rm -f ${remoteTmp}`,
    ],
    { stdio: "inherit", dryRun },
  );
}

async function attachToSprite(
  spriteName: string,
  spriteCmd: string,
  org: string | undefined,
  remoteWorkDir: string,
  dryRun: boolean,
) {
  const cockpitGitSshCommand =
    'ssh -i "$HOME/.ssh/cockpit_github_ed25519" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new';
  const shellArgs = [
    ...spriteScopedArgs(spriteName, org),
    "exec",
    "-tty",
    "-dir",
    remoteWorkDir,
    "/bin/sh",
    "-c",
    `if [ -f "$HOME/.ssh/cockpit_github_ed25519" ]; then export GIT_SSH_COMMAND='${cockpitGitSshCommand.replaceAll("'", "'\\''")}'; fi; export PATH="$(npm prefix -g)/bin:$PATH"; if command -v bash >/dev/null 2>&1; then exec bash -l; fi; exec sh`,
  ];
  
  if (dryRun) {
    await runOk(spriteCmd, shellArgs, { stdio: "inherit", dryRun });
    return;
  }

  const child = spawn(spriteCmd, shellArgs, { stdio: "inherit" });
  const exitCode: number = await new Promise((resolve) =>
    child.on("close", (code) => resolve(code ?? 0)),
  );

  if (exitCode !== 0) {
    throw new Error(`shell exited with code ${exitCode}`);
  }
}

async function cmdAttach(dryRun: boolean) {
  if (!isInTmux()) {
    throw new Error("cockpit attach requires tmux. Run inside a tmux session.");
  }

  const spriteName = await getTmuxWindowSprite();
  if (!spriteName) {
    throw new Error("No Sprite for this tmux window. Run `cockpit` first to create one.");
  }

  const org = process.env.COCKPIT_SPRITE_ORG;
  const spriteCmd = process.env.SPRITE_BIN?.trim() || "sprite";

  const probe = await probeSpriteExistence(spriteCmd, spriteName, org, dryRun);
  if (probe.existence === "no") {
    await clearTmuxWindowSprite(dryRun);
    throw new Error(
      `Sprite "${spriteName}" bound to this tmux window was not found.\n` +
        "The binding was cleared. Run `cockpit` to create a new one.",
    );
  }
  if (probe.existence === "unknown") {
    const suffix = probe.detail ? `\n\n${probe.detail}` : "";
    throw new Error(`Failed to verify Sprite "${spriteName}". Try again.${suffix}`);
  }

  const remoteHome = await getRemoteHome(spriteCmd, spriteName, org, dryRun);
  const remoteWorkDir = `${remoteHome}/workspace`;

  const managed = await isCockpitManagedGithubKey();
  if (managed) {
    await runOk(
      spriteCmd,
      [
        ...spriteScopedArgs(spriteName, org),
        "exec",
        "-file",
        `${COCKPIT_GITHUB_KEY_PATH}:/tmp/cockpit_github_ed25519`,
        "/bin/sh",
        "-c",
        `mkdir -p ~/.ssh && chmod 700 ~/.ssh && mv /tmp/cockpit_github_ed25519 ~/.ssh/cockpit_github_ed25519 && chmod 600 ~/.ssh/cockpit_github_ed25519`,
      ],
      { stdio: "inherit", dryRun },
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Attaching to Sprite: ${spriteName}`);
  await attachToSprite(spriteName, spriteCmd, org, remoteWorkDir, dryRun);
}

async function ensureSshDir() {
  const sshDir = path.join(os.homedir(), ".ssh");
  await fs.mkdir(sshDir, { recursive: true });
  await fs.chmod(sshDir, 0o700);
}

async function isCockpitManagedGithubKey(): Promise<boolean> {
  if (!(await pathExists(COCKPIT_GITHUB_KEY_PATH))) return false;
  if (!(await pathExists(COCKPIT_GITHUB_KEY_PUB_PATH))) return false;

  const pubLine = (await fs.readFile(COCKPIT_GITHUB_KEY_PUB_PATH, "utf-8")).trim();
  const pub = parseAuthorizedKeyLine(pubLine);
  if (!pub.comment.startsWith(COCKPIT_GITHUB_KEY_COMMENT_PREFIX)) return false;

  const derived = await spawnPromise("ssh-keygen", ["-y", "-f", COCKPIT_GITHUB_KEY_PATH], { stdio: "pipe" });
  if (derived.code !== 0) return false;
  const derivedPub = parseAuthorizedKeyLine(derived.stdout.trim());

  return pub.type === derivedPub.type && pub.key === derivedPub.key;
}

async function maybeAddKeyToGithubViaGh(pubKeyPath: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const gh = await spawnPromise("gh", ["--version"], { stdio: "ignore" });
  if (gh.code !== 0) return;

  const auth = await spawnPromise("gh", ["auth", "status", "-h", "github.com"], { stdio: "ignore" });
  if (auth.code !== 0) return;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Add this key to GitHub now via `gh`? (y/N): ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") return;
  } finally {
    rl.close();
  }

  const title = `cockpit sprite ${os.hostname()} ${nowStamp()}`;
  await runOk("gh", ["ssh-key", "add", pubKeyPath, "--title", title], { stdio: "inherit" });
}

async function cmdInit() {
  await ensureSshDir();

  const keyPath = COCKPIT_GITHUB_KEY_PATH;
  const pubKeyPath = COCKPIT_GITHUB_KEY_PUB_PATH;

  if (await pathExists(keyPath)) {
    const managed = await isCockpitManagedGithubKey();
    if (!managed) {
      throw new Error(
        `Refusing to use existing key at ${keyPath} because it does not look like a cockpit-managed key.\n` +
          `Move it aside (and its .pub), then run \`cockpit init\` again.`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`Cockpit GitHub SSH key already exists: ${keyPath}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`Generating SSH key: ${keyPath}`);
    const comment = `${COCKPIT_GITHUB_KEY_COMMENT_PREFIX}${os.hostname()}:${os.userInfo().username}:${nowStamp()}`;
    await runOk("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", comment], {
      stdio: "inherit",
    });
    await fs.chmod(keyPath, 0o600);
    await fs.chmod(pubKeyPath, 0o644);
  }

  const pubKey = (await fs.readFile(pubKeyPath, "utf-8")).trim();

  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("Add this public key to your GitHub account:");
  // eslint-disable-next-line no-console
  console.log("  https://github.com/settings/ssh/new");
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(pubKey);
  // eslint-disable-next-line no-console
  console.log("");

  await maybeAddKeyToGithubViaGh(pubKeyPath);
}

async function cmdDestroy(dryRun: boolean) {
  if (!isInTmux()) {
    throw new Error("cockpit destroy requires tmux. Run inside a tmux session.");
  }

  const spriteName = await getTmuxWindowSprite();
  if (!spriteName) {
    throw new Error("No Sprite for this tmux window.");
  }

  const org = process.env.COCKPIT_SPRITE_ORG;
  const spriteCmd = process.env.SPRITE_BIN?.trim() || "sprite";

  // eslint-disable-next-line no-console
  console.log(`Destroying Sprite: ${spriteName}`);
  await runOk(spriteCmd, [...spriteScopedArgs(spriteName, org), "destroy", "-force"], {
    stdio: "inherit",
    dryRun,
    allowFailure: true,
  });

  try {
    await clearTmuxWindowSprite(dryRun);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(err instanceof Error ? err.message : String(err));
  }
  // eslint-disable-next-line no-console
  console.log("Sprite destroyed and tmux window unbound.");
}

async function cmdCreate(dryRun: boolean, qa: boolean, qaTurn: boolean) {
  const org = process.env.COCKPIT_SPRITE_ORG;
  const branch = process.env.COCKPIT_BRANCH?.trim() || "master";
  const spriteCmd = process.env.SPRITE_BIN?.trim() || "sprite";

  // In tmux, check if window already has a Sprite
  if (isInTmux()) {
    const existingSprite = await getTmuxWindowSprite();
    if (existingSprite) {
      const probe = await probeSpriteExistence(spriteCmd, existingSprite, org, dryRun);
      if (probe.existence === "no") {
        // eslint-disable-next-line no-console
        console.log(
          `Found stale tmux window binding to Sprite "${existingSprite}". Clearing and continuing.`,
        );
        await clearTmuxWindowSprite(dryRun);
      } else if (probe.existence === "unknown") {
        const suffix = probe.detail ? `\n\n${probe.detail}` : "";
        throw new Error(
          `This tmux window already has Sprite "${existingSprite}" bound, but it could not be verified.\n` +
            "Use `cockpit attach` to connect, or `cockpit destroy` to clear it." +
            suffix,
        );
      } else {
        throw new Error(
          `This tmux window already has Sprite "${existingSprite}".\n` +
            `Use \`cockpit attach\` to connect, or \`cockpit destroy\` first.`,
        );
      }
    }
  }

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
  {
    const res = await spawnPromise(spriteCmd, [...spriteArgsBase(org), "create", "-skip-console", spriteName], {
      stdio: "pipe",
      dryRun,
    });
    if (res.code !== 0) {
      // eslint-disable-next-line no-console
      console.error(res.stdout + res.stderr);
      throw new Error(`sprite create failed (${res.code})`);
    }
    // Best-effort: suppress noisy console-attach errors that `sprite create` sometimes prints even when successful.
    const lines = (res.stdout + res.stderr)
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.includes("Connecting to console") && !l.includes("sprite not found"));
    if (lines.length > 0) {
      // eslint-disable-next-line no-console
      console.log(lines.join("\n"));
    }
  }

  const inTmux = isInTmux();
  let spriteReady = false;
  let tmuxBound = false;

  let cleaningUp = false;

  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    const shouldDestroy = !spriteReady || qa || qaTurn || !inTmux;
    if (shouldDestroy) {
      await runOk(spriteCmd, [...spriteScopedArgs(spriteName, org), "destroy", "-force"], {
        stdio: "inherit",
        dryRun,
        allowFailure: true,
      });
      if (tmuxBound) {
        try {
          await clearTmuxWindowSprite(dryRun);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log(err instanceof Error ? err.message : String(err));
        }
      }
    }
  };

  const handleSignal = (sig: NodeJS.Signals) => {
    void (async () => {
      await cleanup();
      process.exit(sig === "SIGTERM" ? 143 : 130);
    })();
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  try {
    const remoteHome = await getRemoteHome(spriteCmd, spriteName, org, dryRun);
    const remoteWorkDir = `${remoteHome}/workspace`;

    let gitSshCommand = "";
    if (repoNeedsSsh(repoUrl)) {
      const managed = await isCockpitManagedGithubKey();
      if (!managed) {
        throw new Error(
          `Missing cockpit GitHub SSH key at ${COCKPIT_GITHUB_KEY_PATH}.\n` +
            "Run `cockpit init` and add the public key to GitHub.",
        );
      }

      gitSshCommand =
        "ssh -i ~/.ssh/cockpit_github_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new";

      await runOk(
        spriteCmd,
        [
          ...spriteScopedArgs(spriteName, org),
          "exec",
          "-file",
          `${COCKPIT_GITHUB_KEY_PATH}:/tmp/cockpit_github_ed25519`,
          "/bin/sh",
          "-c",
          `mkdir -p ~/.ssh && chmod 700 ~/.ssh && mv /tmp/cockpit_github_ed25519 ~/.ssh/cockpit_github_ed25519 && chmod 600 ~/.ssh/cockpit_github_ed25519`,
        ],
        { stdio: "inherit", dryRun },
      );
      // eslint-disable-next-line no-console
      console.log(`Uploaded cockpit GitHub SSH key: ${COCKPIT_GITHUB_KEY_PATH}`);
    }

    // Bootstrap tools + pi.
    await runOk(
      spriteCmd,
      [
        ...spriteScopedArgs(spriteName, org),
        "exec",
        "/bin/sh",
        "-c",
        remoteBootstrapScript(),
      ],
      { stdio: "inherit", dryRun },
    );

    // Clone repo into /workspace (master preferred).
    await runOk(
      spriteCmd,
      [
        ...spriteScopedArgs(spriteName, org),
        "exec",
        "/bin/sh",
        "-c",
        remoteCloneScript(repoUrl, branch, remoteWorkDir, gitSshCommand),
      ],
      { stdio: "inherit", dryRun },
    );

    // Copy ~/.pi into /root/.pi in the sprite (best-effort).
    const hostPiDir = path.join(os.homedir(), ".pi");
    if (await pathExists(hostPiDir)) {
      // Exclude host-specific binaries (often macOS) so pi can provision Linux tools itself.
      const tarPath = await tarDirectoryWithExcludes(hostPiDir, [".pi/agent/bin"], dryRun);
      try {
        await uploadAndExtractTarball(spriteCmd, spriteName, org, tarPath, "/tmp/host-pi.tar.gz", dryRun);
      } finally {
        if (!dryRun) {
          await fs.rm(tarPath, { force: true });
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`Note: ${hostPiDir} not found; skipping pi config sync.`);
    }

    // Sanity checks before entering TTY mode.
    await runOk(
      spriteCmd,
      [
        ...spriteScopedArgs(spriteName, org),
        "exec",
        "/bin/sh",
        "-c",
        `cd '${remoteWorkDir.replaceAll("'", "'\\''")}' && export PATH="$(npm prefix -g)/bin:$PATH" && command -v pi && pi --version && test -d .git`,
      ],
      { stdio: "inherit", dryRun },
    );

    spriteReady = true;

    if (qaTurn) {
      const qaTurnScript = `
set -eu
cd '${remoteWorkDir.replaceAll("'", "'\\''")}'
export PATH="$(npm prefix -g)/bin:$PATH"
rm -f answer.txt
pi --print --no-session "Use the write tool to create a file named answer.txt in the current directory with exactly the text 42 and a trailing newline." || true
if [ ! -f answer.txt ]; then
  echo "QA TURN FAIL: answer.txt missing" >&2
  exit 1
fi
if [ "$(tr -d '\\n' < answer.txt)" != "42" ]; then
  echo "QA TURN FAIL: answer.txt content was:" >&2
  cat answer.txt >&2 || true
  exit 1
fi
echo "QA TURN OK"
`;
      await runOk(
        spriteCmd,
        [...spriteScopedArgs(spriteName, org), "exec", "/bin/sh", "-c", qaTurnScript],
        { stdio: "inherit", dryRun },
      );
      // eslint-disable-next-line no-console
      console.log("QA OK: pi ran one turn and wrote answer.txt.");
      return;
    }

    if (qa) {
      await runOk(
        spriteCmd,
        [
          ...spriteScopedArgs(spriteName, org),
          "exec",
          "/bin/sh",
          "-c",
          `cd '${remoteWorkDir.replaceAll("'", "'\\''")}' && export PATH="$(npm prefix -g)/bin:$PATH" && pi --help >/dev/null`,
        ],
        { stdio: "inherit", dryRun },
      );
      // eslint-disable-next-line no-console
      console.log("QA OK: pi installed and repo cloned.");
      return;
    }

    // In tmux, bind this Sprite to the window once it is ready.
    if (inTmux) {
      await setTmuxWindowSprite(spriteName, dryRun);
      tmuxBound = true;
      // eslint-disable-next-line no-console
      console.log(`Bound Sprite "${spriteName}" to this tmux window.`);
    }

    // Drop into a shell in a TTY inside the sprite.
    await attachToSprite(spriteName, spriteCmd, org, remoteWorkDir, dryRun);
  } finally {
    await cleanup();
  }
}

async function main() {
  await warnIfDistLooksStale();

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "cockpit - run pi inside a Fly Sprite",
        "",
        "Usage:",
        "  cockpit              Create a new Sprite and attach (claims tmux window)",
        "  cockpit attach       Attach to this tmux window's Sprite",
        "  cockpit destroy      Destroy this tmux window's Sprite",
        "  cockpit init         Generate ~/.ssh/cockpit_github_ed25519 and show GitHub setup",
        "",
        "Env:",
        "  COCKPIT_REPO_URL     Repo URL to clone (default: current dir origin remote)",
        "  COCKPIT_BRANCH       Branch to checkout (default: master)",
        "  COCKPIT_SPRITE_ORG   Fly org name (optional)",
        "",
        "tmux Integration:",
        "  In tmux, `cockpit` binds the Sprite to the current window.",
        "  New panes can auto-attach via shell hook. Add to fish config:",
        "",
        "    if set -q TMUX",
        "        set -l sprite (tmux show-option -wqv @cockpit_sprite 2>/dev/null)",
        "        if test -n \"$sprite\"",
        "            cockpit attach",
        "        end",
        "    end",
        "",
        "Debug:",
        "  cockpit --dry-run    Print commands without running them",
        "  cockpit --qa         Provision + sanity-check, then exit",
        "  cockpit --qa-turn    Run 1 pi turn (costs tokens), then exit",
      ].join("\n"),
    );
    return;
  }

  const dryRun = args.dryRun || process.env.COCKPIT_DRY_RUN === "1";
  const qa = args.qa || process.env.COCKPIT_QA === "1";
  const qaTurn = args.qaTurn || process.env.COCKPIT_QA_TURN === "1";

  switch (args.subcommand) {
    case "init":
      await cmdInit();
      break;
    case "attach":
      await cmdAttach(dryRun);
      break;
    case "destroy":
      await cmdDestroy(dryRun);
      break;
    case "create":
    default:
      await cmdCreate(dryRun, qa, qaTurn);
      break;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
