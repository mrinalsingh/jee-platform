import { Module } from "@nestjs/common";
import { TestSessionsController } from "./test-sessions.controller";
import { TestSessionsService } from "./test-sessions.service";

@Module({
  controllers: [TestSessionsController],
  providers: [TestSessionsService],
})
export class TestSessionsModule {}
