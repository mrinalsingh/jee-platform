import { Test } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { ProblemsController } from "./problems.controller";
import { ProblemsService } from "./problems.service";

describe("ProblemsController", () => {
  let controller: ProblemsController;
  let svc: jest.Mocked<ProblemsService>;

  beforeEach(async () => {
    const mockSvc: Partial<jest.Mocked<ProblemsService>> = {
      createReview: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [ProblemsController],
      providers: [{ provide: ProblemsService, useValue: mockSvc }],
    }).compile();
    controller = mod.get(ProblemsController);
    svc = mod.get(ProblemsService) as jest.Mocked<ProblemsService>;
  });

  it("happy path: returns review id + new consensus", async () => {
    svc.createReview.mockResolvedValueOnce({
      review_id: "5",
      new_consensus_t: "T3",
      new_consensus_score: 9.3,
    });
    const req: any = { auth: { role: "teacher", teacherId: 1n, sessionId: "s" } };
    const out = await controller.createReview(req, "MAT.SPL.X.Y.001", {
      reviewer_role: "jee_platform_critic",
      t_rating: "T3",
      jee_authenticity_score: 9.3,
    });
    expect(out.review_id).toBe("5");
  });

  it("cross-walk violation: 422 with structured body", async () => {
    svc.createReview.mockImplementationOnce(() => {
      throw new HttpException(
        {
          error: "cross_walk_violation",
          message: "would push consensus outside band",
          details: {},
          retry_guidance: "Revise score.",
        },
        422,
      );
    });
    const req: any = { auth: { role: "teacher", teacherId: 1n, sessionId: "s" } };
    await expect(
      controller.createReview(req, "MAT.SPL.X.Y.001", {
        reviewer_role: "jee_platform_critic",
        t_rating: "T3",
        jee_authenticity_score: 9.7,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
