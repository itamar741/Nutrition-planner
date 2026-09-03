import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.endsWith(".png") && !file.endsWith(".zip"));

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

const findings = [];
for (const file of trackedFiles) {
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(contents)) {
      findings.push(`${file}: possible ${pattern.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Security check failed:\n" + findings.join("\n"));
  process.exit(1);
}

console.log(
  `Security check passed (${trackedFiles.length} tracked files scanned).`,
);
