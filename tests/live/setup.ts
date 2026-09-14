import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const previousNodeEnv = process.env.NODE_ENV;

Reflect.set(process.env, "NODE_ENV", "development");
loadEnvConfig(process.cwd(), true, undefined, true);
if (previousNodeEnv === undefined) {
  Reflect.deleteProperty(process.env, "NODE_ENV");
} else {
  Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
}
