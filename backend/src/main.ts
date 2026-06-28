/**
 * NestJS bootstrap — architecture §10 + §11.
 *
 *  - `helmet()` for the standard set of security headers (CSP, HSTS, XSS).
 *  - `cookie-parser` so the AuthGuard can read the session cookie.
 *  - Global `ValidationPipe` so all DTOs are validated by class-validator
 *    decorators and unknown fields are stripped.
 */

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS off per architecture §5 — same-origin only in v1.
  app.enableCors(false);

  await app.listen(process.env.PORT ?? 4000);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("bootstrap failed:", e);
  process.exit(1);
});
