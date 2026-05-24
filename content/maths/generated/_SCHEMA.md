# Question file format (v1)

Every file in this directory is a `.yaml` representation of **one fresh, original** JEE-Advanced-level problem with its full 7-axis identity and authored difficulty rating. Files here are loaded into the `problems` table by the importer (Stage 3 of the build sequence).

**Filename:** `<question_code>.yaml`, where `question_code = TOPIC.SUBTOPIC.IDEA.SUB-IDEA.NNN` and `NNN` is a three-digit serial within that fingerprint.

**Hard rule:** no source PDFs / images / past JEE problems in this folder. Those live under `/docs/calibration-samples/`. This folder is **fresh originals only** (per §9 of the binding doc — "source PDFs are raw material, never inventory").

## Required fields

| Field | Type | Notes |
|---|---|---|
| `schema_version` | int | Bumped on incompatible format changes. Current: **1**. |
| `question_code` | string | Unique. Must match the filename. |
| `fingerprint.topic` | enum | See [`taxonomy/maths.yaml`](../../taxonomy/maths.yaml) §`topics`. |
| `fingerprint.subtopic` | enum | See `subtopics.<topic>`. |
| `fingerprint.idea` | enum | See `ideas.<topic.subtopic>`. |
| `fingerprint.sub_idea` | enum | See `sub_ideas.<topic.subtopic.idea>`. |
| `fingerprint.answer_type` | enum | `MCQ-SC` \| `MCQ-MC` \| `NUM-INT` \| `NUM-DEC` \| `MAT-COL`. |
| `fingerprint.surface` | enum | `SURF-PLAIN` / `SET` / `FUNC` / `GEOM` / `PARAM` / `PASS`. |
| `fingerprint.trap` | enum | `TRAP-NONE` / `EIGEN` / `CAYLEY` / `LHOP` / `NCERT` / `EDGE` / `PARTIAL` / `LENGTH`. |
| `authored_difficulty` | enum | `T1` – `T5`. Anchored to a top-10-rank-level student in their last 4–5 months. |
| `authored_time_by_round` | object | `R1_seconds`, `R2_seconds`, `R3_seconds`, `R4_seconds`. |
| `status` | enum | `provisional` (no human approval) \| `calibrated` (approved + ≥30 empirical attempts). |
| `provenance` | object | `inspired_by` (sample id), `parallel_form` (bool), `generator`, `created_on`, `human_reviewer` (null until approved), `approved_at` (null until approved). |
| `statement` | markdown string | KaTeX-compatible LaTeX inside. The student sees this. |
| `answer` | object | For MCQ: `{type, correct_options: [A, B, ...]}`. For NUM: `{type, value: <number>}`. |
| `solution` | markdown string | The canonical solution. JEE-syllabus methods only. |
| `wrong_paths` | array of objects | 2–3 entries. Each: `path`, `landed_on_option`, `diagnosis`. Critical for analytics. |
| `review_notes` | string | Notes for the human reviewer. |

## Rules enforced by the importer (Stage 3)

1. **All required fields present.** Missing fields ⇒ record rejected.
2. **Fingerprint matches filename.** Mismatch ⇒ rejected.
3. **Fingerprint values exist in `/content/taxonomy/maths.yaml`.** New value ⇒ extend the taxonomy file first (per §4: no miscellaneous tags).
4. **`question_code` is unique within the bank.**
5. **Approved files (`status: calibrated`, non-null `approved_at`) are immutable.** To revise an approved problem, create a new file with the next serial.

## Conventions
- LaTeX uses `$...$` for inline, `$$...$$` for display blocks (KaTeX/MathJax compatible).
- All time values in **seconds** (matches the `attempts.time_seconds` column).
- All dates in ISO 8601.
- For `wrong_paths.landed_on_option`: for MCQ-MC, list which options the wrong path picks; for NUM types, the value the wrong path produces.
