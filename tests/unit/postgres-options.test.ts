import { describe, expect, it } from "vitest";
import {
  applicationPoolConfig,
  migrationPoolConfig,
} from "@/persistence/postgres-options";

const databaseUrl = [
  "postgresql",
  "://course-user",
  ":course-pass@",
  "db.test/course",
].join("");

describe.each([
  ["application", applicationPoolConfig, 5],
  ["migration", migrationPoolConfig, 1],
] as const)("%s PostgreSQL pool", (_name, createConfig, expectedMax) => {
  it("uses certificate verification when TLS is required", () => {
    const config = createConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "require",
      DATABASE_CA_CERT: undefined,
    });

    expect(config.max).toBe(expectedMax);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("passes a configured CA certificate to the verified TLS connection", () => {
    const config = createConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "require",
      DATABASE_CA_CERT: "first-line\\nsecond-line",
    });

    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "first-line\nsecond-line",
    });
  });

  it.each(["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"])(
    "rejects a DATABASE_URL containing %s",
    (parameter) => {
      expect(() =>
        createConfig({
          DATABASE_URL: `${databaseUrl}?${parameter}=require`,
          DATABASE_SSL: "require",
          DATABASE_CA_CERT: undefined,
        }),
      ).toThrow("DATABASE_URL must not contain TLS options");
    },
  );
});
