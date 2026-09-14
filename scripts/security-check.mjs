import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const reviewFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.endsWith(".png") && !file.endsWith(".zip"));

const trackedFiles = execFileSync("git", ["ls-files", "-z", "--cached"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

function isForbiddenSubmissionPath(file) {
  const parts = file.replaceAll("\\", "/").split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  return (
    parts.includes(".git") ||
    (basename.startsWith(".env") && basename !== ".env.example")
  );
}

const secretPatterns = [
  {
    name: "OpenAI-style API key",
    expression: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "private key",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "credential-bearing PostgreSQL URL",
    expression: /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/g,
  },
];

const nestedArchiveExtensions = new Set([
  ".7z",
  ".bz2",
  ".gz",
  ".rar",
  ".tar",
  ".tbz",
  ".tbz2",
  ".tgz",
  ".txz",
  ".xz",
  ".zip",
  ".zst",
  ".zstd",
]);
const maximumArchiveEntries = 5_000;
const maximumArchiveTextBytes = 1_000_000;
const embeddedArchiveSignatures = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]),
];
const startSignatures = [
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  Buffer.from("BZh"),
  Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
];

function scanText(label, contents, findings) {
  for (const pattern of secretPatterns) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(contents)) {
      findings.push(`${label}: possible ${pattern.name}`);
    }
  }
}

function hasNestedArchiveExtension(entry) {
  const basename = entry.split("/").at(-1)?.toLowerCase() ?? "";
  const extensionIndex = basename.lastIndexOf(".");
  return (
    extensionIndex !== -1 &&
    nestedArchiveExtensions.has(basename.slice(extensionIndex))
  );
}

function hasNestedArchiveSignature(contents) {
  const zstandardMagic =
    contents.length >= 4 ? contents.readUInt32LE(0) : undefined;
  return (
    startSignatures.some((signature) =>
      contents.subarray(0, signature.length).equals(signature),
    ) ||
    (zstandardMagic !== undefined &&
      zstandardMagic >= 0x184d2a50 &&
      zstandardMagic <= 0x184d2a5f) ||
    embeddedArchiveSignatures.some((signature) =>
      contents.includes(signature),
    ) ||
    contents.subarray(257, 262).equals(Buffer.from("ustar"))
  );
}

function literalZipPattern(entry) {
  return [...entry]
    .map((character) => {
      if (character === "*") return "[*]";
      if (character === "?") return "[?]";
      if (character === "[") return "[[]";
      return character;
    })
    .join("");
}

const findings = [];
for (const file of trackedFiles.filter(isForbiddenSubmissionPath)) {
  findings.push(`${file}: local environment file or Git metadata is tracked`);
}

for (const file of reviewFiles) {
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  scanText(file, contents, findings);
}

const archiveFlag = process.argv.indexOf("--archive");
if (archiveFlag !== -1) {
  const archivePath = process.argv[archiveFlag + 1];
  if (!archivePath) {
    console.error("Security check failed: --archive requires a ZIP file path.");
    process.exit(1);
  }
  let archiveEntries;
  try {
    archiveEntries = execFileSync("unzip", ["-Z1", archivePath], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    console.error(`Security check failed: could not inspect ${archivePath}.`);
    process.exit(1);
  }
  if (archiveEntries.length > maximumArchiveEntries) {
    findings.push(
      `${archivePath}: archive has more than ${maximumArchiveEntries} entries`,
    );
    archiveEntries = [];
  }
  for (const entry of archiveEntries.filter(isForbiddenSubmissionPath)) {
    findings.push(`${archivePath}:${entry}: forbidden submission path`);
  }
  for (const entry of archiveEntries) {
    if (entry.endsWith("/") || isForbiddenSubmissionPath(entry)) {
      continue;
    }
    let contents;
    try {
      contents = execFileSync(
        "unzip",
        ["-p", archivePath, literalZipPattern(entry)],
        {
          maxBuffer: maximumArchiveTextBytes,
          timeout: 5_000,
        },
      );
    } catch {
      findings.push(
        `${archivePath}:${entry}: could not safely scan bounded contents`,
      );
      continue;
    }
    if (
      hasNestedArchiveExtension(entry) ||
      hasNestedArchiveSignature(contents)
    ) {
      findings.push(`${archivePath}:${entry}: nested archive is not allowed`);
      continue;
    }
    scanText(`${archivePath}:${entry}`, contents.toString("utf8"), findings);
  }
}

if (findings.length > 0) {
  console.error("Security check failed:\n" + findings.join("\n"));
  process.exit(1);
}

console.log(
  `Security check passed (${reviewFiles.length} project files scanned${
    archiveFlag === -1 ? "" : "; submission archive inspected"
  }).`,
);
