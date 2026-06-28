/**
 * DTOs for the test-session lifecycle. class-validator decorators enforce
 * shape + size guards before the controller sees the body.
 */

import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateSessionDto {
  @IsString()
  test_assignment_id!: string;
}

export class HeartbeatDto {
  @IsEnum(["START", "HEARTBEAT"] as const)
  action!: "START" | "HEARTBEAT";
}

export class SnapshotPatchDto {
  @IsOptional()
  answer_payload?: unknown;

  @IsBoolean()
  marked_for_review!: boolean;

  @IsInt()
  @Min(0)
  @Max(86_400) // sanity cap
  time_seconds_delta!: number;

  @IsInt()
  @Min(0)
  visit_count!: number;

  @IsInt()
  @Min(0)
  action_seq!: number;

  @IsInt()
  client_timestamp_ms!: number;
}

export type ViolationType =
  | "TAB_SWITCH"
  | "WINDOW_BLUR"
  | "FULLSCREEN_EXIT"
  | "RIGHT_CLICK"
  | "COPY_ATTEMPT"
  | "CUT_ATTEMPT"
  | "PASTE_ATTEMPT"
  | "DEVTOOLS_KEYSTROKE"
  | "COPY_KEY_SHORTCUT";

export class ViolationDto {
  @IsEnum([
    "TAB_SWITCH",
    "WINDOW_BLUR",
    "FULLSCREEN_EXIT",
    "RIGHT_CLICK",
    "COPY_ATTEMPT",
    "CUT_ATTEMPT",
    "PASTE_ATTEMPT",
    "DEVTOOLS_KEYSTROKE",
    "COPY_KEY_SHORTCUT",
  ])
  violation_type!: ViolationType;

  @IsBoolean()
  was_active!: boolean;

  @IsInt()
  client_timestamp_ms!: number;
}

export type AutoSubmitSource =
  | "TIMER_EXPIRY"
  | "VIOLATION_THRESHOLD"
  | "NETWORK_FAILURE_FALLBACK"
  | "MANUAL";

export class SubmitDto {
  @IsBoolean()
  auto_submit!: boolean;

  @IsEnum([
    "TIMER_EXPIRY",
    "VIOLATION_THRESHOLD",
    "NETWORK_FAILURE_FALLBACK",
    "MANUAL",
  ])
  auto_submit_source!: AutoSubmitSource;

  @IsString()
  client_final_state_hash!: string;
}

export class LateSnapshotEntryDto {
  @IsInt()
  @Min(0)
  slot_index!: number;

  @IsOptional()
  answer_payload?: unknown;

  @IsInt()
  @Min(0)
  action_seq!: number;

  @IsInt()
  client_timestamp_ms!: number;
}

export class LateSnapshotsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LateSnapshotEntryDto)
  snapshots!: LateSnapshotEntryDto[];
}
