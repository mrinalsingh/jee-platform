-- Rollback for 0003_taxonomy_enums.
-- NOTE: ALTER TYPE ... DROP VALUE is unsupported in Postgres. Reversing the
-- AnswerType extension requires create-new-cast-drop, which only makes sense
-- AFTER all columns referencing the type are dropped (handled by 0007 down).
-- Here we only drop the new enums and leave AnswerType's extra values in
-- place; the schema columns referencing them no longer exist after their
-- migration's down.sql runs.

DROP TYPE IF EXISTS "DrillRecommendationStatus";
DROP TYPE IF EXISTS "ViolationType";
DROP TYPE IF EXISTS "AutoSubmitSource";
DROP TYPE IF EXISTS "TestSessionStatus";
DROP TYPE IF EXISTS "ParentRelationship";
DROP TYPE IF EXISTS "AssignmentScope";
DROP TYPE IF EXISTS "ReviewerRole";
DROP TYPE IF EXISTS "SyllabusStatus";
DROP TYPE IF EXISTS "TargetExam";

-- AnswerType: full reversal requires recreating the type without the
-- placeholder values. Only safe when ALL referencing columns are gone.
-- See backend/scripts/reset-answer-type.sql for the manual reversal recipe.
