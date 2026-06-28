import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateReviewDto {
  @IsEnum([
    "jee_platform_critic",
    "jee_mcq_critic",
    "human_reviewer_primary",
    "human_reviewer_secondary",
    "automated_calibration",
  ])
  reviewer_role!:
    | "jee_platform_critic"
    | "jee_mcq_critic"
    | "human_reviewer_primary"
    | "human_reviewer_secondary"
    | "automated_calibration";

  @IsEnum(["T1", "T2", "T3", "T4", "T5"])
  t_rating!: "T1" | "T2" | "T3" | "T4" | "T5";

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  jee_authenticity_score?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
