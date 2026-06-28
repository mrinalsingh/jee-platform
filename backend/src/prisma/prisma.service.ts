/**
 * Shared Prisma client for the NestJS app.
 *
 * Architecture §3.2: the running app connects as `app_user_login` via the
 * `DATABASE_URL` env var, NOT `MIGRATION_DATABASE_URL`. The former lacks
 * UPDATE/DELETE on `attempts` and `test_session_audit` by REVOKE (migration
 * 0011), so append-only is structural rather than policy.
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

// PrismaService is a thin proxy over the generated client that defers the
// import to construction time. The generated client uses `import.meta.url`
// which Jest's CommonJS runtime cannot evaluate at module-load — by deferring
// the require, controller unit tests (which never instantiate this service —
// they DI-override it with a mock) avoid loading the client at all.

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // Underlying Prisma client instance. Typed `any` so we don't pull the
  // generated client's types into the spec compile graph — services that need
  // typed access call `this.client` directly and TypeScript infers `any` for
  // the `$queryRawUnsafe` overloads we use.
  private client: any;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set; see architecture §11.1");
    }
    // Deferred require — see note above.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require("../../generated/prisma/client");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaPg } = require("@prisma/adapter-pg");
    const adapter = new PrismaPg({ connectionString: url });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  // Pass-through accessors so callers can write `prisma.$queryRawUnsafe(...)`
  // unchanged. We keep the API surface explicit to the methods we actually use.
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> {
    return this.client.$queryRawUnsafe(query, ...values);
  }
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
    return this.client.$executeRawUnsafe(query, ...values);
  }
  $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.client.$transaction(fn);
  }
  // Direct passthrough for cases that need the high-level model API (importer
  // uses prisma.problem.update / create).
  get problem(): any {
    return this.client.problem;
  }
}
