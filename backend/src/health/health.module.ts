/**
 * Health module — wires the @Public() /api/health endpoint into the app.
 * See HealthController for rationale.
 */

import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
