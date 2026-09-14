import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("submission archive security check", () => {
  it("rejects a credential inside an otherwise permitted source file", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "nutrition-security-archive-"),
    );
    temporaryDirectories.push(directory);
    const submission = path.join(directory, "submission", "src");
    mkdirSync(submission, { recursive: true });
    const credential = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    writeFileSync(
      path.join(submission, "config.ts"),
      `export const database = ${JSON.stringify(credential)};`,
    );
    const archive = path.join(directory, "submission.zip");
    execFileSync("zip", ["-q", "-r", archive, "submission"], {
      cwd: directory,
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/security-check.mjs", "--archive", archive],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "config.ts: possible credential-bearing PostgreSQL URL",
    );
    expect(output).not.toContain(credential);
  });

  it("detects a credential after a NUL byte in a permitted source file", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "nutrition-security-archive-nul-"),
    );
    temporaryDirectories.push(directory);
    const submission = path.join(directory, "submission", "src");
    mkdirSync(submission, { recursive: true });
    const credential = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    writeFileSync(
      path.join(submission, "config.ts"),
      Buffer.concat([
        Buffer.from("bounded text before NUL\0", "utf8"),
        Buffer.from(credential, "utf8"),
      ]),
    );
    const archive = path.join(directory, "submission.zip");
    execFileSync("zip", ["-q", "-r", archive, "submission"], {
      cwd: directory,
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/security-check.mjs", "--archive", archive],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "config.ts: possible credential-bearing PostgreSQL URL",
    );
    expect(output).not.toContain(credential);
  });

  it("detects a credential in an entry with a binary-looking extension", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "nutrition-security-archive-binary-name-"),
    );
    temporaryDirectories.push(directory);
    const submission = path.join(directory, "submission", "assets");
    mkdirSync(submission, { recursive: true });
    const credential = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    writeFileSync(
      path.join(submission, "evidence.png"),
      Buffer.from(`not really an image: ${credential}`, "utf8"),
    );
    const archive = path.join(directory, "submission.zip");
    execFileSync("zip", ["-q", "-r", archive, "submission"], {
      cwd: directory,
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/security-check.mjs", "--archive", archive],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "evidence.png: possible credential-bearing PostgreSQL URL",
    );
    expect(output).not.toContain(credential);
  });

  it("rejects a nested archive disguised with another extension", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "nutrition-security-archive-nested-"),
    );
    temporaryDirectories.push(directory);
    const submission = path.join(directory, "submission", "assets");
    const nestedSource = path.join(directory, "nested-source");
    mkdirSync(submission, { recursive: true });
    mkdirSync(nestedSource, { recursive: true });
    writeFileSync(path.join(nestedSource, "readme.txt"), "nested content");
    const nestedZip = path.join(directory, "nested.zip");
    execFileSync("zip", ["-q", "-r", nestedZip, "nested-source"], {
      cwd: directory,
    });
    renameSync(nestedZip, path.join(submission, "nested.png"));
    const archive = path.join(directory, "submission.zip");
    execFileSync("zip", ["-q", "-r", archive, "submission"], {
      cwd: directory,
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/security-check.mjs", "--archive", archive],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("nested.png: nested archive is not allowed");
  });

  it.each([
    {
      format: "XZ",
      extension: "xz",
      prefix: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
    },
    {
      format: "BZip2",
      extension: "bz2",
      prefix: Buffer.from("BZh9"),
    },
    {
      format: "Zstandard",
      extension: "zst",
      prefix: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
    },
    {
      format: "SFX-prefixed RAR",
      extension: "rar",
      prefix: Buffer.concat([
        Buffer.alloc(128, 0x41),
        Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]),
      ]),
    },
  ])(
    "rejects disguised $format content and its .$extension extension",
    ({ format, extension, prefix }) => {
      const directory = mkdtempSync(
        path.join(tmpdir(), "nutrition-security-archive-format-"),
      );
      temporaryDirectories.push(directory);
      const submission = path.join(directory, "submission", "assets");
      mkdirSync(submission, { recursive: true });
      const credential = [
        "postgresql",
        "://course-user",
        ":course-password@",
        "database.test/course",
      ].join("");
      const disguisedName = `${format
        .toLowerCase()
        .replace(/[^a-z]+/g, "-")}.bin`;
      writeFileSync(
        path.join(submission, disguisedName),
        Buffer.concat([prefix, Buffer.from(credential, "utf8")]),
      );
      writeFileSync(
        path.join(submission, `named.${extension}`),
        "harmless compressed-container placeholder",
      );
      const archive = path.join(directory, "submission.zip");
      execFileSync("zip", ["-q", "-r", archive, "submission"], {
        cwd: directory,
      });

      const result = spawnSync(
        process.execPath,
        ["scripts/security-check.mjs", "--archive", archive],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain(
        `${disguisedName}: nested archive is not allowed`,
      );
      expect(output).toContain(
        `named.${extension}: nested archive is not allowed`,
      );
      expect(output).not.toContain(credential);
    },
  );

  it("rejects an SFX-prefixed ZIP containing a sentinel credential", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "nutrition-security-archive-sfx-zip-"),
    );
    temporaryDirectories.push(directory);
    const submission = path.join(directory, "submission", "assets");
    const nestedSource = path.join(directory, "nested-source");
    mkdirSync(submission, { recursive: true });
    mkdirSync(nestedSource, { recursive: true });
    const credential = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    writeFileSync(path.join(nestedSource, "config.ts"), credential);
    const innerZip = path.join(directory, "inner.zip");
    execFileSync("zip", ["-q", "-r", innerZip, "nested-source"], {
      cwd: directory,
    });
    writeFileSync(
      path.join(submission, "sfx-zip.bin"),
      Buffer.concat([Buffer.alloc(128, 0x41), readFileSync(innerZip)]),
    );
    const archive = path.join(directory, "submission.zip");
    execFileSync("zip", ["-q", "-r", archive, "submission"], {
      cwd: directory,
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/security-check.mjs", "--archive", archive],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("sfx-zip.bin: nested archive is not allowed");
    expect(output).not.toContain(credential);
  });

  it("rejects an SFX-prefixed 7z entry containing a sentinel credential", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "nutrition-security-archive-sfx-7z-"),
    );
    temporaryDirectories.push(directory);
    const submission = path.join(directory, "submission", "assets");
    mkdirSync(submission, { recursive: true });
    const credential = [
      "postgresql",
      "://course-user",
      ":course-password@",
      "database.test/course",
    ].join("");
    writeFileSync(
      path.join(submission, "sfx-7z.bin"),
      Buffer.concat([
        Buffer.alloc(128, 0x41),
        Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
        Buffer.from(credential),
      ]),
    );
    const archive = path.join(directory, "submission.zip");
    execFileSync("zip", ["-q", "-r", archive, "submission"], {
      cwd: directory,
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/security-check.mjs", "--archive", archive],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("sfx-7z.bin: nested archive is not allowed");
    expect(output).not.toContain(credential);
  });
});
