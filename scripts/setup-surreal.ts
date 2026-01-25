/**
 * Idempotent SurrealDB binary installer.
 *
 * Installs SurrealDB binary to .bin/ directory within the repository.
 * Reads expected version from .surrealdb-version file.
 *
 * Usage: deno task setup
 */

const VERSION_FILE = ".surrealdb-version";
const BIN_DIR = ".bin";
const BINARY_NAME = Deno.build.os === "windows" ? "surreal.exe" : "surreal";
const BINARY_PATH = `${BIN_DIR}/${BINARY_NAME}`;

async function getExpectedVersion(): Promise<string> {
  try {
    const content = await Deno.readTextFile(VERSION_FILE);
    return content.trim();
  } catch {
    throw new Error(`Missing ${VERSION_FILE} file`);
  }
}

async function getInstalledVersion(): Promise<string | null> {
  try {
    const command = new Deno.Command(BINARY_PATH, { args: ["version"] });
    const { stdout, success } = await command.output();
    if (!success) return null;
    // Parse "3.0.0-beta.2 for linux on x86_64" -> "v3.0.0-beta.2"
    // Also handles "2.2.1 for linux on x86_64" -> "v2.2.1"
    const output = new TextDecoder().decode(stdout).trim();
    const match = output.match(/^(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
    if (match) return `v${match[1]}`;
  } catch {
    // Binary doesn't exist or failed to run
  }
  return null;
}

function getArchString(): string {
  const os = Deno.build.os;
  const arch = Deno.build.arch;

  if (os === "darwin") {
    return arch === "aarch64" ? "darwin-arm64" : "darwin-amd64";
  } else if (os === "linux") {
    return arch === "aarch64" ? "linux-arm64" : "linux-amd64";
  } else if (os === "windows") {
    return "windows-amd64";
  }

  throw new Error(`Unsupported platform: ${os}/${arch}`);
}

async function installSurreal(version: string): Promise<void> {
  console.log(`Installing SurrealDB ${version}...`);

  const arch = getArchString();
  const url = `https://download.surrealdb.com/${version}/surreal-${version}.${arch}.tgz`;

  console.log(`Downloading from ${url}...`);

  // Download and extract
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  // Create .bin directory
  await Deno.mkdir(BIN_DIR, { recursive: true });

  // Use tar to extract (available on Linux/macOS)
  const tarCmd = new Deno.Command("tar", {
    args: ["xz", "-C", BIN_DIR],
    stdin: "piped",
  });
  const tarProcess = tarCmd.spawn();
  const writer = tarProcess.stdin.getWriter();

  for await (const chunk of response.body!) {
    await writer.write(chunk);
  }
  await writer.close();

  const { success } = await tarProcess.status;
  if (!success) throw new Error("Failed to extract archive");

  // Make executable
  await Deno.chmod(BINARY_PATH, 0o755);

  console.log(`Installed to ${BINARY_PATH}`);
}

// Main
async function main(): Promise<void> {
  const expected = await getExpectedVersion();
  const installed = await getInstalledVersion();

  if (installed === expected) {
    console.log(`SurrealDB ${expected} already installed`);
    return;
  }

  if (installed) {
    console.log(`Upgrading SurrealDB from ${installed} to ${expected}`);
  } else {
    console.log(`SurrealDB not found, installing ${expected}`);
  }

  await installSurreal(expected);
  console.log("Done!");
}

main().catch((e) => {
  console.error("Setup failed:", e.message);
  Deno.exit(1);
});
