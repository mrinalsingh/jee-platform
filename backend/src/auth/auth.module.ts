import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthSessionService } from "./auth-session.service";
import { AuthGuard } from "./auth.guard";

@Module({
  controllers: [AuthController],
  providers: [
    AuthSessionService,
    // Global guard: every request must have a valid session unless the
    // handler is decorated with @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthSessionService],
})
export class AuthModule {}
