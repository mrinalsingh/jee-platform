/**
 * DB privilege integration spec — Stage 4 Tester gap #9 + architecture §3.2.
 *
 * Confirms the STRUCTURAL append-only invariant: when the running NestJS app
 * connects to Postgres as `app_user_login` (the role behind `app_user`), it
 *   * CANNOT UPDATE or DELETE rows in `attempts`
 *   * CANNOT UPDATE or DELETE rows in `test_session_audit`
 *   * CAN INSERT into `attempts` (positive control)
 *
 * Postgres rejects forbidden DML with SQLSTATE `42501` (insufficient_privilege).
 * That's what we assert.
 *
 * Setup expectations (the test does NOT create them):
 *   * Postgres is reachable.
 *   * `TEST_DATABASE_URL` (preferred) or `DATABASE_URL` (fallback) is a
 *     connection string that authenticates as the `app_user_login` user
 *     (architecture §3.2 mapping) against a database where all migrations
 *     have been applied — i.e. the schema, roles, and REVOKEs are in place.
 *   * Environment variable `INTEGRATION=true` is set, otherwise the suite is
 *     skipped so CI's default unit runner can never trip on it.
 *
 * Run with: `npm run test:integration` (from `backend/`).
 */

import { Client } from "pg";

const RUN = process.env.INTEGRATION === "true";
const CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

const describeIf = RUN ? describe : describe.skip;

describeIf("DB privilege — app_user_login append-only invariant", () => {
  let client: Client;

  beforeAll(async () => {
    if (!CONNECTION_STRING) {
      throw new Error(
        "INTEGRATION=true requires TEST_DATABASE_URL or DATABASE_URL to be set",
      );
    }
    client = new Client({ connectionString: CONNECTION_STRING });
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  // Sanity check — confirm the connection is actually authenticating as the
  // app_user_login user. If a tester accidentally points TEST_DATABASE_URL at
  // a migration-role connection string, the rest of the suite would (wrongly)
  // pass nothing because owner privileges trump REVOKE.
  it("connects as app_user_login (architecture §3.2 mapping)", async () => {
    const r = await client.query("SELECT current_user::text AS u");
    expect(r.rows[0].u).toBe("app_user_login");
  });

  describe("attempts (REVOKE UPDATE, DELETE — migration 0012)", () => {
    it("UPDATE on attempts fails with 42501 insufficient_privilege", async () => {
      await expect(
        // WHERE clause matches nothing, but Postgres checks privilege BEFORE
        // it walks rows, so this still produces 42501.
        client.query("UPDATE attempts SET correct = NOT correct WHERE id = -1"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("DELETE on attempts fails with 42501 insufficient_privilege", async () => {
      await expect(
        client.query("DELETE FROM attempts WHERE id = -1"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    // Positive control — confirms the REVOKE didn't accidentally take INSERT
    // too. We immediately roll back so we don't pollute the table.
    it("INSERT into attempts is allowed (positive control)", async () => {
      await client.query("BEGIN");
      try {
        // We don't actually expect this insert to *succeed* — the FK and
        // NOT NULL constraints will reject it because we're passing nonsense
        // values. But the FAILURE SQLSTATE we want is anything OTHER than
        // 42501 (we want a constraint code like 23503 / 23502 / 22P02), which
        // proves the privilege check passed.
        await client.query(
          `INSERT INTO attempts (
             student_id, question_code, correct, time_seconds,
             attempt_order, round_at_time
           ) VALUES (
             -1, 'NONE.NONE.NONE.000.000', false, 0, 1, 'R1'
           )`,
        );
        // If somehow the insert succeeded, that's also fine — privilege passed.
      } catch (e: any) {
        expect(e.code).not.toBe("42501");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  describe("test_session_audit (REVOKE UPDATE, DELETE — migration 0012)", () => {
    it("UPDATE on test_session_audit fails with 42501 insufficient_privilege", async () => {
      await expect(
        client.query(
          "UPDATE test_session_audit SET endpoint = 'TAMPER' WHERE id = -1",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("DELETE on test_session_audit fails with 42501 insufficient_privilege", async () => {
      await expect(
        client.query("DELETE FROM test_session_audit WHERE id = -1"),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
