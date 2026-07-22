import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hardenAgentWorkflowLock, GH_AW_VERSION } from "./harden-ai-insights-lock";

type ReleaseAsset = {
  name: string;
  sha256: string;
};

const RELEASE_BASE = `https://github.com/github/gh-aw/releases/download/${GH_AW_VERSION}`;
const RELEASE_ASSETS: Partial<Record<`${NodeJS.Platform}-${string}`, ReleaseAsset>> = {
  "linux-x64": {
    name: "linux-amd64",
    sha256: "299df4ffdbbadfd18ed61ea2483b7cc93d0a2292cfca7ab82afc1bc72572e5a8"
  },
  "win32-x64": {
    name: "windows-amd64.exe",
    sha256: "12964e72cc0c1a75c1b9508ece438e630af42d8fb77ec86b64495898ebd9eb92"
  }
};

const LOCK_PATH = resolve(".github/workflows/ai-insights.lock.yml");

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

  const cacheDir = join(tmpdir(), "azure-ops-pulse-gh-aw", GH_AW_VERSION);
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
}

await main();
