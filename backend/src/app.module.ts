/**
 * Root NestJS module.
 *
 * Wires:
 *   - PrismaModule (global) — shared Prisma client.
 *   - AuthModule — login/logout + global AuthGuard.
 *   - DashboardModule — Req M UNION-DEDUPE endpoint.
 *   - TestSessionsModule — endpoints 3..13 of architecture §5.3.
 *   - ProblemsModule — endpoint 14 (review write with 422 cross-walk).
 *   - HealthModule — public /api/health probe for Render zero-downtime deploys.
 *   - ThrottlerModule — per-architecture §5.5 rate limits.
 */

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { TestSessionsModule } from "./test-sessions/test-sessions.module";
import { ProblemsModule } from "./problems/problems.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    PrismaModule,
    // Conservative defaults (overall budget); per-endpoint limits configured at
    // route level later when the throttler stabilises.
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60_000, limit: 600 },
    ]),
    AuthModule,
    DashboardModule,
    TestSessionsModule,
    ProblemsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
