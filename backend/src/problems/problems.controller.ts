/**
 * Problems controller — endpoint 14 of architecture §5.4.
 *
 * POST /api/problems/:question_code/reviews — teacher/admin writes a review;
 * the AFTER trigger recomputes consensus. Cross-walk violations come back as
 * a structured 422 (see ProblemsService.projectPgError).
 */

import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { AllowRoles } from "../auth/auth.guard";
import type { AuthedRequest } from "../auth/auth.guard";
import { CreateReviewDto } from "./problems.dto";
import { ProblemsService } from "./problems.service";

@Controller("api/problems")
export class ProblemsController {
  private readonly log = new Logger("ProblemsController");

  constructor(private readonly svc: ProblemsService) {}

  /**
   * POST /api/problems/:question_code/reviews — endpoint 14.
   *
   * Teacher-only. The AFTER trigger on problem_reviews recomputes consensus
   * and may RAISE EXCEPTION USING ERRCODE='23514' with the prefix
   * `cross_walk_violation:` if the consensus would fall outside the band.
   * That projection happens in the service.
   */
  @AllowRoles("teacher")
  @Post(":question_code/reviews")
  @HttpCode(201)
  async createReview(
    @Req() req: AuthedRequest,
    @Param("question_code") questionCode: string,
    @Body() dto: CreateReviewDto,
  ): Promise<{ review_id: string; new_consensus_t: string; new_consensus_score: number | null }> {
    const out = await this.svc.createReview(questionCode, dto);
    this.log.log(
      `review created qc=${questionCode} teacher=${req.auth.teacherId} role=${dto.reviewer_role}`,
    );
    return out;
  }
}
