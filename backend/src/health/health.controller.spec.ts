/**
 * HealthController — minimal contract test.
 *
 * Confirms the endpoint returns 200 with the expected shape so Render's
 * deploy probe (architecture §11) gets a stable contract.
 */

import { Test } from "@nestjs/testing";
import { HealthController, HealthPayload } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = mod.get(HealthController);
  });

  describe("GET /api/health", () => {
    it("returns the four documented fields with the right types", () => {
      const r: HealthPayload = controller.health();
      expect(r.status).toBe("ok");
      expect(typeof r.version).toBe("string");
      expect(r.version.length).toBeGreaterThan(0);
      expect(typeof r.uptime).toBe("number");
      expect(r.uptime).toBeGreaterThanOrEqual(0);
      // ISO-8601 — at minimum parses as a valid Date.
      expect(typeof r.timestamp).toBe("string");
      expect(Number.isNaN(Date.parse(r.timestamp))).toBe(false);
    });

    it("timestamp is recent (within the last 5 seconds)", () => {
      const before = Date.now();
      const r = controller.health();
      const after = Date.now();
      const t = Date.parse(r.timestamp);
      expect(t).toBeGreaterThanOrEqual(before - 5);
      expect(t).toBeLessThanOrEqual(after + 5);
    });

    it("uptime grows monotonically across calls", async () => {
      const a = controller.health().uptime;
      // Wait long enough that the floored-second uptime may tick.
      await new Promise((r) => setTimeout(r, 5));
      const b = controller.health().uptime;
      expect(b).toBeGreaterThanOrEqual(a);
    });
  });
});
