#!/usr/bin/env node
// scripts/import-yaml.ts
//
// Imports .yaml problem files (per /content/maths/generated/_SCHEMA.md) into
// the problems table. Idempotent: upserts on question_code. Refuses to
// overwrite a problem already marked `calibrated` — those are immutable.
//
// Usage:
//   npx tsx scripts/import-yaml.ts <file.yaml>
//   npx tsx scripts/import-yaml.ts <directory>           # imports all .yaml in dir
//
// Exit codes:
//   0  all files validated + persisted
//   1  one or more validation failures (no partial commits — fail-stop per file)

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// =============================================================================
// Types — mirror the contract in /content/maths/generated/_SCHEMA.md
// =============================================================================

interface FingerprintYaml {
  topic: string;
  subtopic: string;
  idea: string;
  sub_idea: string;
  answer_type: string;   // YAML uses dashes (e.g. "MCQ-MC"); Prisma uses underscores
  surface: string;
  trap: string;
}

interface ProblemYaml {
  schema_version: number;
  question_code: string;
  fingerprint: FingerprintYaml;
  authored_difficulty: string;
  authored_time_by_round: Record<string, number>;
  status: "provisional" | "calibrated";
  provenance: Record<string, unknown>;
  statement: string;
  answer: Record<string, unknown>;
  solution: string;
  wrong_paths: Array<Record<string, unknown>>;
  review_notes?: string;
}

// =============================================================================
// Helpers
// =============================================================================

// YAML enum strings use dashes; Prisma enum values use underscores.
function toEnum(s: string): string {
  return s.replace(/-/g, "_");
}

// Parse "MAT.SPL.ORBSUM.CNJSP.001" -> structured parts.
function parseCode(code: string): {
  topic: string;
  subtopic: string;
  idea: string;
  sub_idea: string;
  serial: number;
} | null {
  const parts = code.split(".");
  if (parts.length !== 5) return null;
  const serial = parseInt(parts[4], 10);
  if (isNaN(serial)) return null;
  return {
    topic: parts[0],
    subtopic: parts[1],
    idea: parts[2],
    sub_idea: parts[3],
    serial,
  };
}

// =============================================================================
// Validation — enforce the schema contract before any DB write.
// =============================================================================

function validate(yml: ProblemYaml, filepath: string): string[] {
  const errors: string[] = [];

  if (yml.schema_version !== 1) {
    errors.push(`schema_version must be 1, got ${JSON.stringify(yml.schema_version)}`);
  }

  const required: (keyof ProblemYaml)[] = [
    "question_code", "fingerprint", "authored_difficulty",
    "authored_time_by_round", "statement", "answer", "solution", "wrong_paths",
    "status", "provenance",
  ];
  for (const f of required) {
    if (yml[f] === undefined || yml[f] === null) errors.push(`missing required field: ${f}`);
  }

  if (yml.fingerprint) {
    const fpKeys: (keyof FingerprintYaml)[] = [
      "topic", "subtopic", "idea", "sub_idea", "answer_type", "surface", "trap",
    ];
    for (const k of fpKeys) {
      if (!yml.fingerprint[k]) errors.push(`missing fingerprint.${k}`);
    }
  }

  if (!Array.isArray(yml.wrong_paths)) errors.push("wrong_paths must be an array");
  else if (yml.wrong_paths.length < 1) errors.push("wrong_paths must contain at least 1 entry");

  // Filename must match question_code
  const expected = `${yml.question_code}.yaml`;
  if (path.basename(filepath) !== expected) {
    errors.push(`filename "${path.basename(filepath)}" doesn't match question_code "${yml.question_code}" (expected "${expected}")`);
  }

  // question_code structure + fingerprint internal consistency
  const parsed = parseCode(yml.question_code);
  if (!parsed) {
    errors.push(`question_code "${yml.question_code}" doesn't parse as TOPIC.SUBTOPIC.IDEA.SUB_IDEA.NNN`);
  } else if (yml.fingerprint) {
    if (parsed.topic !== yml.fingerprint.topic)
      errors.push(`code topic "${parsed.topic}" ≠ fingerprint.topic "${yml.fingerprint.topic}"`);
    if (parsed.subtopic !== yml.fingerprint.subtopic)
      errors.push(`code subtopic "${parsed.subtopic}" ≠ fingerprint.subtopic "${yml.fingerprint.subtopic}"`);
    if (parsed.idea !== yml.fingerprint.idea)
      errors.push(`code idea "${parsed.idea}" ≠ fingerprint.idea "${yml.fingerprint.idea}"`);
    if (parsed.sub_idea !== yml.fingerprint.sub_idea)
      errors.push(`code sub_idea "${parsed.sub_idea}" ≠ fingerprint.sub_idea "${yml.fingerprint.sub_idea}"`);
  }

  // NOTE: We do NOT yet validate that fingerprint values exist in
  // /content/taxonomy/maths.yaml. Add when the taxonomy stabilises so the
  // importer rejects unknown axis values rather than silently widening the bank.

  return errors;
}

// =============================================================================
// Per-file import
// =============================================================================

type Outcome = "inserted" | "updated" | "skipped" | "failed";

async function importFile(prisma: PrismaClient, filepath: string): Promise<Outcome> {
  let yml: ProblemYaml;
  try {
    yml = yaml.load(fs.readFileSync(filepath, "utf-8")) as ProblemYaml;
  } catch (e: any) {
    console.error(`❌ ${path.basename(filepath)} — YAML parse error: ${e.message}`);
    return "failed";
  }

  const errors = validate(yml, filepath);
  if (errors.length > 0) {
    console.error(`❌ ${path.basename(filepath)} — validation failed:`);
    errors.forEach((e) => console.error(`   • ${e}`));
    return "failed";
  }

  const parsed = parseCode(yml.question_code)!;

  // Respect immutability of calibrated problems.
  const existing = await prisma.problem.findUnique({
    where: { questionCode: yml.question_code },
    select: { status: true },
  });
  if (existing?.status === "calibrated") {
    console.warn(`⚠️  ${yml.question_code} — already calibrated; skipping (create a new serial to revise)`);
    return "skipped";
  }

  const data = {
    questionCode: yml.question_code,
    topicCode: yml.fingerprint.topic,
    subtopicCode: yml.fingerprint.subtopic,
    ideaCode: yml.fingerprint.idea,
    subIdeaCode: yml.fingerprint.sub_idea,
    serial: parsed.serial,
    answerType: toEnum(yml.fingerprint.answer_type) as any,
    surface: toEnum(yml.fingerprint.surface) as any,
    trap: toEnum(yml.fingerprint.trap) as any,
    authoredDifficulty: yml.authored_difficulty as any,
    authoredTimeByRound: yml.authored_time_by_round,
    statement: yml.statement,
    answer: yml.answer,
    solution: yml.solution,
    wrongPaths: yml.wrong_paths,
    status: yml.status as any,
    sourceMetadata: yml.provenance,
  };

  if (existing) {
    await prisma.problem.update({ where: { questionCode: yml.question_code }, data });
    console.log(`✏️  ${yml.question_code} — updated`);
    return "updated";
  } else {
    await prisma.problem.create({ data });
    console.log(`✅ ${yml.question_code} — inserted`);
    return "inserted";
  }
}

// =============================================================================
// CLI entry point
// =============================================================================

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npx tsx scripts/import-yaml.ts <file.yaml | directory>");
    process.exit(2);
  }

  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs.readdirSync(target).filter((f) => f.endsWith(".yaml")).map((f) => path.join(target, f))
    : [target];

  if (files.length === 0) {
    console.warn("No .yaml files found.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — check backend/.env");
    process.exit(2);
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const totals: Record<Outcome, number> = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

  try {
    console.log(`Importing ${files.length} file(s)…\n`);
    for (const f of files) {
      const outcome = await importFile(prisma, f);
      totals[outcome]++;
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n--- summary ---`);
  console.log(`inserted: ${totals.inserted}`);
  console.log(`updated:  ${totals.updated}`);
  console.log(`skipped:  ${totals.skipped}`);
  console.log(`failed:   ${totals.failed}`);

  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
