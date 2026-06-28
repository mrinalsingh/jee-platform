# Taxonomy extensions required for the 0609d pilot import

Add these axis-1..4 codes to content/taxonomy/maths.yaml before/at import.
(The importer does NOT reject unknown codes, so import works without this — but the
taxonomy should match the bank.)

**Harmonization note (2026-06-09):** the three `MAT.SYS.*` items now sit on ONE idea
`DETCLS` with three sub-ideas. So merge what the per-question notes below say about
`MAT.SYS.RANKCON.*` into a single canonical block:

```yaml
# in maths.yaml, under TOPIC MAT, SUBTOPIC SYS (Systems of linear equations):
ideas:
  DETCLS: "Classify a parametrized 3x3 linear system by its coefficient determinant D(parameter):
           D != 0 => unique point; D = 0 => either coincident (rank=rank of augmented) or
           inconsistent (rank < rank of augmented)."
sub_ideas:
  MAT.SYS.DETCLS:
    RANKCON: "Two-RHS test at the singular value — compare rank of coefficient vs augmented
              matrix to separate coincident (∞ many solutions) from inconsistent (none).
              Multiplicity-of-root trap on D=0."
    DETFAC:  "Factor D(parameter) explicitly to read off all singular values AND their
              multiplicities; a double root signals where the parallel-vs-coincident split lives."
    LINPAR:  "D linear in the parameter — exactly one singular value, simplest variant; the
              consistency check at that single value is the whole problem."
```

## MAT.SYS.DETCLS.RANKCON.001  (from 0609d Q1)
Extend /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml under MAT.SYS (Systems of linear equations), which currently has no IDEA. Add IDEA `DETCLS` to `ideas:` block (key `MAT.SYS`): "DETCLS: Classify a parametrized 3x3 linear system by the coefficient determinant D(parameter): D != 0 gives a unique point; D = 0 splits into infinitely-many vs no-solution by a rank/consistency check." Add SUB-IDEA `RANKCON` to `sub_ideas:` block (key `MAT.SYS.DETCLS`): "RANKCON: At a singular parameter value, compare rank of the coefficient matrix with rank of the augmented matrix (varying the RHS) to separate the coincident/infinitely-many case from the parallel-distinct/inconsistent case; beware the multiplicity trap that det = cubic implies 3 distinct roots." Both codes are <=6 chars. These must be added before importing this YAML.

## VEC.PLN.NRMCNT.ANTPOD.001  (from 0609d Q2)
Extend /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml: TOPIC VEC already exists but has no SUBTOPIC yet. Add SUBTOPIC VEC.PLN = "Planes in 3D (normal-vector form, distinct-plane counting, orthogonality of normals)". Add IDEA VEC.PLN.NRMCNT = "Count distinct planes through a fixed point by collapsing antipodal normal vectors (n and -n give the same plane) into projective directions, then count combinatorial structures (orthogonal triples, sign-pattern classes) among them." Add SUB-IDEA VEC.PLN.NRMCNT.ANTPOD = "Antipodal collapse: 2k ordered nonzero normals over a small symmetric coefficient set give k distinct planes; then count mutually-perpendicular unordered triples and all-coordinates-nonzero (sign-pattern) planes via dot-product = 0 and 2^3 / ± pairing."

## PRB.IES.EXACTLYK.SYMSUM.001  (from 0609d Q3)
PRB topic exists but has NO subtopic/idea/sub_idea yet. Extend /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml with: SUBTOPIC PRB.IES = "Inclusion-exclusion and combinations of events (exactly-k / at-least-k of n events, complementary counting)"; IDEA PRB.IES.EXACTLYK = "Decompose probabilities of 'exactly k' / 'at least k' / 'at most k' of n events using the symmetric sums S1=ΣP(A_i), S2=ΣP(A_i∩A_j), S3=P(A∩B∩C): P(exactly two)=S2−3S3, P(exactly one)=S1−2S2+3S3, P(union)=S1−S2+S3."; SUB-IDEA PRB.IES.EXACTLYK.SYMSUM = "Apply the binomial-weighted 'exactly-k' formulas to three events; the key trap is conflating 'at most one' with the complement of the union (1−P(∪)=P(none), not P(at most one))."

## PRB.DSC.CNTEVT.PRODDIV.001  (from 0609d Q4)
Add under TOPIC PRB (Probability), which currently has no SUBTOPIC. New nodes: SUBTOPIC `DSC` = "Discrete / equally-likely sample spaces (count-favorable-over-total)"; IDEA `CNTEVT` = "event probability by counting favorable outcomes in a finite product sample space against an arithmetic condition"; SUB-IDEA `PRODDIV` = "event is a divisibility/size condition on the product of independent uniform digits; count multiset compositions, watch boundary cutoff". All four fingerprint values (PRB, DSC, CNTEVT, PRODDIV) plus answer_type MCQ-MC, surface SURF-PARAM, trap TRAP-EDGE already-listed enums; PRB.DSC.CNTEVT.PRODDIV must be added to /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml before import.

## PRB.BND.MARGPOLY.BONFMARK.001  (from 0609d Q5)
PRB exists as a TOPIC but has no SUBTOPIC/IDEA/SUB-IDEA. Add to /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml under PRB: SUBTOPIC BND = "Probabilistic bounds (distribution-free; valid for every joint distribution / coupling consistent with given marginals)"; IDEA MARGPOLY = "bounds over the marginal polytope {p>=0: sum p=1, fixed P(E_i)}; sharp bounds attained at a vertex, so 'valid for all couplings' = worst-case extreme point"; SUB-IDEA BONFMARK = "Bonferroni P(∩E_i)>=1-Σ(1-P(E_i)) for the intersection, plus Markov on the failure-count X=#{events that fail} (E[X]=Σ(1-P(E_i))) to bound P(at least k occur); both bounds sharp/attained".

## PNC.COM.LATDIR.GCDRED.001  (from 0609d Q6)
Extend /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml under PNC. SUBTOPIC PNC.COM already exists (Combinations and selections). Add IDEA: PNC.COM -> LATDIR: "Counting distinct lattice direction vectors (and relations like perpendicularity among them): each (a,b,c) in a small integer box represents a direction; collapse proportional tuples to primitive ones, then count primitive classes or count pairs satisfying a dot-product condition." Add SUB-IDEA: PNC.COM.LATDIR -> GCDRED: "Reduce each integer tuple by its gcd to a primitive direction; the number of distinct directions = total tuples - non-primitive tuples that collapse onto smaller ones; then enumerate unordered pairs with n1·n2=0 over the primitive set." (LATDIR and GCDRED are both <=6 chars.)

## MAT.SYS.RANKCON.DETFAC.001  (from 0609d Q7)
Extended /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml. Subtopic MAT.SYS (Systems of linear equations) already existed but had no IDEA. Added IDEA MAT.SYS.RANKCON ("Factor the coefficient determinant to locate parameter values where it vanishes; at each compare coefficient rank vs augmented rank to classify the system") and SUB-IDEA MAT.SYS.RANKCON.DETFAC ("Determinant factors as (n−1)²(n+2); test each RHS at the degenerate parameters: equal rows with equal RHS ⇒ coincident planes / infinitely many solutions; equal coeff rank but larger augmented rank ⇒ inconsistent"). TOPIC=MAT and SUBTOPIC=SYS are pre-existing.

## PRB.COMP.INCEXC.EXACTK.001  (from 0609d Q8)
TOPIC PRB (Probability) existed but had no SUBTOPIC/IDEA/SUB-IDEA. Extended /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml with: SUBTOPIC PRB.COMP = "Compound events (set-algebra of events; union/intersection/exactly-k; inclusion-exclusion on probabilities)"; IDEA PRB.COMP.INCEXC = "Inclusion-exclusion on event probabilities: S_1=ΣP(A_i), S_2=ΣP(A_i∩A_j), S_3=P(∩A_i); P(exactly k of n) and P(at least k) are fixed linear combinations of the S_j; a stated union/triple-intersection pins down the missing symmetric sum"; SUB-IDEA PRB.COMP.INCEXC.EXACTK = "Exactly-k decomposition for three events: P(exactly one)=S_1−2S_2+3S_3, P(exactly two)=S_2−3S_3, P(exactly three)=S_3, P(none)=1−(S_1−S_2+S_3); a stated union value recovers S_2 and exposes the 'none=1−P(∪)' and 'at most one' traps". All three nodes added and the file re-validated as parseable YAML.

## PRB.DSC.UNIFENUM.DETCOLLAPSE.001  (from 0609d Q9)
Extend /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml with one new SUBTOPIC, IDEA, and SUB-IDEA under PRB (TOPIC PRB already exists). SUBTOPIC: PRB.DSC = "Discrete / classical probability over a finite equally-likely sample space (enumerate outcomes, read the distribution)". IDEA: PRB.DSC.UNIFENUM = "Reduce a random algebraic or geometric quantity to a single discrete scalar, enumerate the finite equally-likely sample space, and read probabilities directly from the value distribution." SUB-IDEA: PRB.DSC.UNIFENUM.DETCOLLAPSE = "Collapse a 3x3 determinant / scalar triple product to a signed linear form (e.g. p-q+r), then tabulate |form| over the {0,1,2}^3 grid; coplanarity is form=0, volume V=|form|." Existing PRB.COMP (compound events / inclusion-exclusion on event probabilities) does not fit because this is classical sample-space enumeration, not event set-algebra.

## MAT.SYS.RANKCON.LINPAR.001  (from 0609d Q10)
Add ONE new AXIS-4 SUB-IDEA under existing IDEA MAT.SYS.RANKCON (TOPIC=MAT Matrices and Determinants; SUBTOPIC=SYS Systems of linear equations; IDEA=RANKCON already exists). New sub_idea code LINPAR: "Coefficient determinant is linear (degree 1) in the parameter, so it vanishes at a single value; at that value the coefficient rank drops to 2 while the augmented rank stays 3, so the system is INCONSISTENT (no solution) rather than having infinitely many — the standard singular-implies-infinite-solutions trap." This is distinct from the existing sibling MAT.SYS.RANKCON.DETFAC (whose det factors as (n-1)^2(n+2), a cubic with a double root giving coincident planes). The IDEA RANKCON and SUBTOPIC SYS both already exist; only the sub_idea LINPAR must be appended to sub_ideas under key MAT.SYS.RANKCON in /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml.

## MAT.SPL.ORTHCOL.SCLORTH.001  (from 0609d Q11)
Extend /Users/ms/Documents/jee_platform/content/taxonomy/maths.yaml under MAT.SPL. Add IDEA ORTHCOL: "Columns that are mutually orthogonal with equal norm k make P a scaled-orthogonal matrix: PᵀP = PPᵀ = k²I, so P⁻¹ = k⁻²Pᵀ, det P = ±kⁿ, adj P = (det P)P⁻¹ = (det P)k⁻²Pᵀ, and the Gram matrix equals PᵀP." Add SUB-IDEA MAT.SPL.ORTHCOL.SCLORTH: "From PᵀP = k²I cascade the standard facts — inverse (k⁻²Pᵀ), solving Px=b by x = k⁻²Pᵀb, adjugate = (det P)·k⁻²·Pᵀ, and det(Gram) = (det P)² = k^{2n}; traps are dropping the k⁻² factor and confusing P with Pᵀ." Both TOPIC (MAT) and SUBTOPIC (SPL) already exist; only the IDEA and SUB-IDEA are new. No new TOPIC/SUBTOPIC needed.

