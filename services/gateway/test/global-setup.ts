import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const IMAGE = "postgres:17.6-alpine";

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

async function waitForPostgres(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("test postgres did not become ready");
}

// Starts one throwaway Postgres for the whole test run and removes it afterwards.
export default async function setup(project: TestProject): Promise<() => void> {
  const password = randomBytes(8).toString("hex");
  const id = docker("run", "-d", "--rm", "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", IMAGE);
  const mapping = docker("port", id, "5432/tcp").split("\n")[0] ?? "";
  const port = mapping.slice(mapping.lastIndexOf(":") + 1);
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  await waitForPostgres(url);
  project.provide("databaseUrl", url);
  return () => {
    docker("stop", "-t", "0", id);
  };
}
