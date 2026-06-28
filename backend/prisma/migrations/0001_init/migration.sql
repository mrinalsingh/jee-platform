-- CreateEnum
CREATE TYPE "AnswerType" AS ENUM ('MCQ_SC', 'MCQ_MC', 'NUM_INT', 'NUM_DEC', 'MAT_COL');

-- CreateEnum
CREATE TYPE "Surface" AS ENUM ('SURF_PLAIN', 'SURF_SET', 'SURF_FUNC', 'SURF_GEOM', 'SURF_PARAM', 'SURF_PASS');

-- CreateEnum
CREATE TYPE "Trap" AS ENUM ('TRAP_NONE', 'TRAP_EIGEN', 'TRAP_CAYLEY', 'TRAP_LHOP', 'TRAP_NCERT', 'TRAP_EDGE', 'TRAP_PARTIAL', 'TRAP_LENGTH');

-- CreateEnum
CREATE TYPE "IntrinsicDifficulty" AS ENUM ('T1', 'T2', 'T3', 'T4', 'T5');

-- CreateEnum
CREATE TYPE "Round" AS ENUM ('R1', 'R2', 'R3', 'R4');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('provisional', 'calibrated');

-- CreateTable
CREATE TABLE "problems" (
    "question_code" TEXT NOT NULL,
    "topic_code" TEXT NOT NULL,
    "subtopic_code" TEXT NOT NULL,
    "idea_code" TEXT NOT NULL,
    "sub_idea_code" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "answer_type" "AnswerType" NOT NULL,
    "surface" "Surface" NOT NULL,
    "trap" "Trap" NOT NULL,
    "authored_difficulty" "IntrinsicDifficulty" NOT NULL,
    "authored_time_by_round" JSONB NOT NULL,
    "empirical_difficulty_by_round" JSONB,
    "empirical_time_by_round" JSONB,
    "statement" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "solution" TEXT NOT NULL,
    "wrong_paths" JSONB NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'provisional',
    "source_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("question_code")
);

-- CreateTable
CREATE TABLE "students" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "target_rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fingerprint_state" (
    "student_id" BIGINT NOT NULL,
    "topic_code" TEXT NOT NULL,
    "subtopic_code" TEXT NOT NULL,
    "idea_code" TEXT NOT NULL,
    "sub_idea_code" TEXT NOT NULL,
    "round" "Round" NOT NULL,
    "mastery_score" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_fingerprint_state_pkey" PRIMARY KEY ("student_id","topic_code","subtopic_code","idea_code","sub_idea_code")
);

-- CreateTable
CREATE TABLE "tests" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "question_codes" JSONB NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "marking_scheme" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" BIGSERIAL NOT NULL,
    "student_id" BIGINT NOT NULL,
    "question_code" TEXT NOT NULL,
    "test_id" BIGINT,
    "correct" BOOLEAN NOT NULL,
    "time_seconds" INTEGER NOT NULL,
    "visit_count" INTEGER NOT NULL DEFAULT 1,
    "marked_for_review" BOOLEAN NOT NULL DEFAULT false,
    "attempt_order" INTEGER NOT NULL,
    "round_at_time" "Round" NOT NULL,
    "hints_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "problems_topic_code_idx" ON "problems"("topic_code");

-- CreateIndex
CREATE INDEX "problems_subtopic_code_idx" ON "problems"("subtopic_code");

-- CreateIndex
CREATE INDEX "problems_idea_code_idx" ON "problems"("idea_code");

-- CreateIndex
CREATE INDEX "problems_sub_idea_code_idx" ON "problems"("sub_idea_code");

-- CreateIndex
CREATE INDEX "problems_answer_type_idx" ON "problems"("answer_type");

-- CreateIndex
CREATE INDEX "problems_surface_idx" ON "problems"("surface");

-- CreateIndex
CREATE INDEX "problems_trap_idx" ON "problems"("trap");

-- CreateIndex
CREATE INDEX "problems_authored_difficulty_idx" ON "problems"("authored_difficulty");

-- CreateIndex
CREATE INDEX "problems_status_idx" ON "problems"("status");

-- CreateIndex
CREATE UNIQUE INDEX "problems_topic_code_subtopic_code_idea_code_sub_idea_code_s_key" ON "problems"("topic_code", "subtopic_code", "idea_code", "sub_idea_code", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "students_email_key" ON "students"("email");

-- CreateIndex
CREATE INDEX "student_fingerprint_state_student_id_idx" ON "student_fingerprint_state"("student_id");

-- CreateIndex
CREATE INDEX "attempts_student_id_idx" ON "attempts"("student_id");

-- CreateIndex
CREATE INDEX "attempts_question_code_idx" ON "attempts"("question_code");

-- CreateIndex
CREATE INDEX "attempts_created_at_idx" ON "attempts"("created_at");

-- CreateIndex
CREATE INDEX "attempts_question_code_created_at_idx" ON "attempts"("question_code", "created_at");

-- AddForeignKey
ALTER TABLE "student_fingerprint_state" ADD CONSTRAINT "student_fingerprint_state_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_question_code_fkey" FOREIGN KEY ("question_code") REFERENCES "problems"("question_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
