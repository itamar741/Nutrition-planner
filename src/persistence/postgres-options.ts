import type { PoolConfig } from "pg";

type DatabaseEnvironment = {
  DATABASE_URL?: string;
  DATABASE_SSL?: string;
  DATABASE_CA_CERT?: string;
};

const conflictingTlsParameters = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
]);

function checkedConnectionString(environment: DatabaseEnvironment) {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const conflicts = [...parsed.searchParams.keys()].filter((key) =>
    conflictingTlsParameters.has(key.toLowerCase()),
  );
  if (conflicts.length > 0) {
    throw new Error(
      "DATABASE_URL must not contain TLS options; use DATABASE_SSL and DATABASE_CA_CERT.",
    );
  }

  return connectionString;
}

function poolConfig(environment: DatabaseEnvironment, max: number): PoolConfig {
  const ca = environment.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString: checkedConnectionString(environment),
    max,
    ssl:
      environment.DATABASE_SSL === "require"
        ? {
            rejectUnauthorized: true,
            ...(ca ? { ca } : {}),
          }
        : undefined,
  };
}

function currentDatabaseEnvironment(): DatabaseEnvironment {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL,
    DATABASE_CA_CERT: process.env.DATABASE_CA_CERT,
  };
}

export function applicationPoolConfig(
  environment: DatabaseEnvironment = currentDatabaseEnvironment(),
) {
  return poolConfig(environment, 5);
}

export function migrationPoolConfig(
  environment: DatabaseEnvironment = currentDatabaseEnvironment(),
) {
  return poolConfig(environment, 1);
}
