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

async function setTmuxWindowSprite(spriteName: string): Promise<void> {
  if (!isInTmux()) return;
  await spawnPromise("tmux", ["set-option", "-w", "@cockpit_sprite", spriteName], {
    stdio: "inherit",
  });
}

async function clearTmuxWindowSprite(): Promise<void> {
  if (!isInTmux()) return;
  await spawnPromise("tmux", ["set-option", "-wu", "@cockpit_sprite"], {
    stdio: "inherit",
  });
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

function remoteCloneScript(repoUrl: string, branch: string, remoteWorkDir: string) {
  const repo = repoUrl.replaceAll("'", "'\\''");
  const b = branch.replaceAll("'", "'\\''");
  const dir = remoteWorkDir.replaceAll("'", "'\\''");
  const parent = path.posix.dirname(remoteWorkDir).replaceAll("'", "'\\''");
  return String.raw`
set -eu

if command -v ssh >/dev/null 2>&1; then
  export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
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

async function attachToSprite(spriteName: string, spriteCmd: string, org: string | undefined, dryRun: boolean) {
  const remoteWorkDir = "/home/sprite/workspace";
  
  const shellArgs = [
    ...spriteScopedArgs(spriteName, org),
    "exec",
    "-tty",
    "-dir",
    remoteWorkDir,
    "/bin/sh",
    "-c",
    'export PATH="$(npm prefix -g)/bin:$PATH"; if command -v bash >/dev/null 2>&1; then exec bash -l; fi; exec sh',
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

  // eslint-disable-next-line no-console
  console.log(`Attaching to Sprite: ${spriteName}`);
  await attachToSprite(spriteName, spriteCmd, org, dryRun);
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

  await clearTmuxWindowSprite();
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
      throw new Error(
        `This tmux window already has Sprite "${existingSprite}".\n` +
        `Use \`cockpit attach\` to connect, or \`cockpit destroy\` first.`
      );
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

  // If in tmux, bind this Sprite to the window
  if (isInTmux()) {
    await setTmuxWindowSprite(spriteName);
    // eslint-disable-next-line no-console
    console.log(`Bound Sprite "${spriteName}" to this tmux window.`);
  }

  // For QA modes and non-tmux, we still auto-cleanup on exit
  const shouldAutoCleanup = qa || qaTurn || !isInTmux();
  
  let cleaningUp = false;

  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    if (shouldAutoCleanup) {
      await runOk(spriteCmd, [...spriteScopedArgs(spriteName, org), "destroy", "-force"], {
        stdio: "inherit",
        dryRun,
        allowFailure: true,
      });
      if (isInTmux()) {
        await clearTmuxWindowSprite();
      }
    }
  };

  const handleSignal = (_sig: NodeJS.Signals) => {
    void (async () => {
      await cleanup();
      process.exit(130); // 128 + SIGINT
    })();
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  try {
    const remoteHome = await getRemoteHome(spriteCmd, spriteName, org, dryRun);
    const remoteWorkDir = `${remoteHome}/workspace`;

    // If repo uses SSH, upload ~/.ssh so git can authenticate.
    if (repoNeedsSsh(repoUrl)) {
      const hostSshDir = path.join(os.homedir(), ".ssh");
      if (await pathExists(hostSshDir)) {
        const sshTar = await tarDirectoryWithExcludes(hostSshDir, [".ssh/*.sock", ".ssh/**/ControlMaster*"], dryRun);
        try {
          await uploadAndExtractTarball(spriteCmd, spriteName, org, sshTar, "/tmp/host-ssh.tar.gz", dryRun);
          await runOk(
            spriteCmd,
            [
              ...spriteScopedArgs(spriteName, org),
              "exec",
              "/bin/sh",
              "-c",
              'if [ -d "${HOME:-/home/sprite}/.ssh" ]; then chmod 700 "${HOME:-/home/sprite}/.ssh" || true; find "${HOME:-/home/sprite}/.ssh" -type d -exec chmod 700 {} \\; 2>/dev/null || true; find "${HOME:-/home/sprite}/.ssh" -type f -exec chmod 600 {} \\; 2>/dev/null || true; fi',
            ],
            { stdio: "inherit", dryRun },
          );
        } finally {
          if (!dryRun) await fs.rm(sshTar, { force: true });
        }
      } else {
        // eslint-disable-next-line no-console
        console.log(`Note: ${hostSshDir} not found; SSH clone may fail.`);
      }
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
        remoteCloneScript(repoUrl, branch, remoteWorkDir),
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

    // Drop into a shell in a TTY inside the sprite.
    await attachToSprite(spriteName, spriteCmd, org, dryRun);
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
