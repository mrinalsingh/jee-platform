import { Test } from "@nestjs/testing";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

describe("DashboardController", () => {
  let controller: DashboardController;
  let service: jest.Mocked<DashboardService>;

  beforeEach(async () => {
    const svc: Partial<jest.Mocked<DashboardService>> = {
      assignedTests: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: svc }],
    }).compile();
    controller = mod.get(DashboardController);
    service = mod.get(DashboardService) as jest.Mocked<DashboardService>;
  });

  it("returns the tests list from the service", async () => {
    service.assignedTests.mockResolvedValueOnce([
      {
        test_assignment_id: "1",
        test_id: "10",
        title: "Mock 1",
        duration_seconds: 10800,
        marking_scheme_summary: {},
        window_start_at: "2026-06-29T10:00:00Z",
        window_end_at: "2026-06-29T13:00:00Z",
        status: "OPEN",
        session_id: null,
        scope: "cohort",
      },
    ]);
    const req: any = { auth: { role: "student", studentId: 42n, sessionId: "s" } };
    const result = await controller.assigned(req);
    expect(result.tests).toHaveLength(1);
    expect(service.assignedTests).toHaveBeenCalledWith(42n);
  });

  it("returns an empty list when the student has no assignments", async () => {
    service.assignedTests.mockResolvedValueOnce([]);
    const req: any = { auth: { role: "student", studentId: 1n, sessionId: "s" } };
    const result = await controller.assigned(req);
    expect(result.tests).toEqual([]);
  });
});
