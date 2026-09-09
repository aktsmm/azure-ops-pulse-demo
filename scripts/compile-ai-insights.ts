import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  hardenAgentWorkflowLock,
  GH_AW_SETUP_SHA,
  GH_AW_VERSION
} from "./harden-ai-insights-lock";

type ReleaseAsset = {
  name: string;
  sha256: string;
};

const RELEASE_BASE = `https://github.com/github/gh-aw/releases/download/${GH_AW_VERSION}`;
const RELEASE_ASSETS: Partial<Record<`${NodeJS.Platform}-${string}`, ReleaseAsset>> = {
  "linux-x64": {
    name: "linux-amd64",
    sha256: "37faaaa95f622b910568bc878452f6036f01e951380fdfc41441944a95da43bf"
  },
  "win32-x64": {
    name: "windows-amd64.exe",
    sha256: "8d88047c1e162f16a01e1920124092c80a8bdf98c1635357067a0ac34c00d4c7"
  }
};

const LOCK_PATH = resolve(".github/workflows/ai-insights.lock.yml");
const ACTIONS_LOCK_PATH = resolve(".github/aw/actions-lock.json");

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function getCompilerPath(): Promise<string> {
  if (process.env.GH_AW_BIN) return resolve(process.env.GH_AW_BIN);

  const asset = RELEASE_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) {
    throw new Error(
      `Unsupported platform ${process.platform}-${process.arch}; set GH_AW_BIN to gh-aw ${GH_AW_VERSION}`
    );
  }

  const cacheDir = resolve(".candidate", "azure-ops-pulse-gh-aw", GH_AW_VERSION);
  const binaryPath = join(cacheDir, asset.name);
  await mkdir(cacheDir, { recursive: true });

  if (existsSync(binaryPath)) {
    if ((await sha256(binaryPath)) === asset.sha256) return binaryPath;
    await rm(binaryPath);
  }

  const response = await fetch(`${RELEASE_BASE}/${asset.name}`);
  if (!response.ok) {
    throw new Error(`Failed to download gh-aw ${GH_AW_VERSION}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(`gh-aw ${GH_AW_VERSION} checksum mismatch for ${asset.name}`);
  }

  const temporaryPath = `${binaryPath}.${process.pid}.download`;
  await writeFile(temporaryPath, bytes);
  if (process.platform !== "win32") await chmod(temporaryPath, 0o755);
  await rm(binaryPath, { force: true });
  await rename(temporaryPath, binaryPath);
  return binaryPath;
}

function run(executable: string, args: string[], capture = false): string {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    shell: false,
    stdio: capture ? "pipe" : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh-aw command failed with exit code ${result.status ?? "unknown"}`);
  }
  return capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

async function pinGhAwSetupAction(): Promise<void> {
  const lock = JSON.parse(await readFile(ACTIONS_LOCK_PATH, "utf8")) as {
    entries?: Record<string, { repo?: string; version?: string; sha?: string }>;
  };
  if (!lock.entries) throw new Error("Actions lock is missing entries");
  for (const [key, entry] of Object.entries(lock.entries)) {
    if (entry.repo === "github/gh-aw-actions/setup") delete lock.entries[key];
  }
  lock.entries[`github/gh-aw-actions/setup@${GH_AW_VERSION}`] = {
    repo: "github/gh-aw-actions/setup",
    version: GH_AW_VERSION,
    sha: GH_AW_SETUP_SHA
  };
  await writeFile(ACTIONS_LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const compiler = await getCompilerPath();
  const version = run(compiler, ["version"], true);
  if (!version.includes(GH_AW_VERSION)) {
    throw new Error(`Expected gh-aw ${GH_AW_VERSION}, received: ${version.trim()}`);
  }

  run(compiler, [
    "compile",
    "ai-insights",
    "--strict",
    "--validate",
    "--no-check-update",
    "--approve"
  ]);

  const compiled = await readFile(LOCK_PATH, "utf8");
  await writeFile(LOCK_PATH, hardenAgentWorkflowLock(compiled), "utf8");
  await pinGhAwSetupAction();
}

await main();
