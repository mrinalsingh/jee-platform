# Calibration batch 001 — PnC + Probability (mixed)

Seven JEE Advanced problems sent for study + key verification. Source years not specified by user; some are clearly recent. Mix of PRB (probability) and PNC (combinatorics).

---

## Q.17 — five students, five seats (derangement, partial fix) — **PRB**

**Statement:** Five students $S_1,\dots,S_5$ initially have seats $R_1,\dots,R_5$ respectively. On exam day, they sit randomly. Find $P\big(S_1$ at $R_1$ **and** none of $S_2,\dots,S_5$ at his/her own seat$\big)$.

**My key: (A) 3/40.**

Fix $S_1$ at $R_1$ — the other 4 must be deranged. $D_4 = 9$. So favorable $= 9$, total $= 5! = 120$. $P = 9/120 = 3/40$.

---

## Q.18 — five students, no consecutive-index pair adjacent — **PRB**

**Statement:** Same paragraph. $T_i$ = "$S_i$ and $S_{i+1}$ NOT adjacent" for $i = 1,2,3,4$. Find $P(T_1 \cap T_2 \cap T_3 \cap T_4)$.

**My key: (C) 7/60.**

By inclusion-exclusion on $A_i$ = "$S_i$ adjacent to $S_{i+1}$":
- $|A_i| = 2 \cdot 4! = 48$, four of them ⇒ $192$
- pairwise (3 overlapping × 12 + 3 non-overlapping × 24) = $108$
- triples (4 triples; counts 4, 8, 8, 4) = $24$
- quadruple = $2$

$|\bigcup A_i| = 192 - 108 + 24 - 2 = 106$. So $|\bigcap T_i| = 120 - 106 = 14$. $P = 14/120 = 7/60$.

---

## Q.13 (probability) — three-event bounds — **PRB**

**Statement:** $P(E) = 1/8$, $P(F) = 1/6$, $P(G) = 1/4$, $P(E \cap F \cap G) = 1/10$. Which is/are true?
- (A) $P(E \cap F \cap G^c) \le 1/40$
- (B) $P(E^c \cap F \cap G) \le 1/15$
- (C) $P(E \cup F \cup G) \le 13/24$
- (D) $P(E^c \cap F^c \cap G^c) \le 5/12$

**My key: (A), (B), (C) correct. (D) incorrect.**

- (A): $P(E \cap F \cap G^c) = P(E \cap F) - 1/10 \le 1/8 - 1/10 = 1/40$. ✓
- (B): same trick — $P(F \cap G) \le 1/6$, so this $\le 1/6 - 1/10 = 1/15$. ✓
- (C): union bound — $\le 1/8 + 1/6 + 1/4 = 13/24$. ✓
- (D): LP on the 8-cell Venn distribution gives a feasible $P(E^c \cap F^c \cap G^c) = 3/4 > 5/12$, so the bound can be violated. ✗

---

## Q.3 (probability) — recursive sets, conditional — **PRB**

**Statement:** $E_1 = \{1,2,3\}$, $F_1 = \{1,3,4\}$, $G_1 = \{2,3,4,5\}$. $S_1$ is 2 random elements from $E_1$; $E_2 = E_1 \setminus S_1$, $F_2 = F_1 \cup S_1$. $S_2$ from $F_2$; $G_2 = G_1 \cup S_2$. $S_3$ from $G_2$; $E_3 = E_2 \cup S_3$. Given $E_1 = E_3$, find $P(S_1 = \{1,2\})$.

**My key: (A) 1/5.**

Cases on $S_1$:
- $S_1 = \{1,2\}$: $P(E_3 = E_1 \mid S_1) = (3/6)(1/10) = 1/20$
- $S_1 = \{1,3\}$: $P = (2/3)(1/10) = 1/15$
- $S_1 = \{2,3\}$: $P = (3/6)(1/10) + (3/6)(1/6) = 8/60 = 2/15$

$P(E_1 = E_3) = (1/3)(1/20 + 1/15 + 2/15) = (1/3)(15/60) = 1/12$.

$P(S_1 = \{1,2\} \mid E_1 = E_3) = (1/20)(1/3)/(1/12) = 12/60 = 1/5$.

---

## Q.13 (PnC) — engineer's 4 visits in 15 days, no consecutive — **PNC**

**Statement:** Choose exactly 4 days out of 15 for factory visits with no two consecutive. How many ways?

**My key: 495.**

Standard stars-and-bars / gap method: $\binom{n-k+1}{k} = \binom{12}{4} = 495$.

---

## Q.14 (PnC) — six persons in four rooms, 1 ≤ occupancy ≤ 2 — **PNC**

**Statement:** Distribute 6 distinct persons to 4 distinct rooms with each room having 1 or 2 occupants.

**My key: 1080.**

Only possible occupancy pattern: exactly two rooms with 2 each, two rooms with 1 each.
- Pick which 2 rooms get doubles: $\binom{4}{2} = 6$
- Fill those 2 double rooms in order: $\binom{6}{2}\binom{4}{2} = 15 \cdot 6 = 90$
- Fill the 2 single rooms in order: $2 \cdot 1 = 2$

Total $= 6 \cdot 90 \cdot 2 = 1080$.

---

## Q.15 (probability) — repeated dice, square vs prime — **PRB**

**Statement:** Two dice rolled, sum noted. Repeat until sum is prime or perfect square. Given perfect square arrives first, let $p$ = probability that this square is odd. Find $14p$.

**My key: 14p = 8.**

Only squares ≤ 12 are 4 and 9. $P(\text{sum}=4) = 3/36$, $P(\text{sum}=9) = 4/36$.

Given the stopping value is a square, the distribution is proportional to $P(s)$:
$P(\text{square} = 9 \mid \text{square wins}) = 4/(3+4) = 4/7$. So $p = 4/7$ and $14p = 8$.

---

## Summary table for quick verification

| Question | Topic | Type | My key |
|---|---|---|---|
| Q.17 | PRB | MCQ-SC | **(A) 3/40** |
| Q.18 | PRB | MCQ-SC | **(C) 7/60** |
| Q.13 prob | PRB | MCQ-MC | **(A), (B), (C)** |
| Q.3 | PRB | MCQ-SC | **(A) 1/5** |
| Q.13 pnc | PNC | NUM-INT | **495** |
| Q.14 | PNC | NUM-INT | **1080** |
| Q.15 | PRB | NUM-INT | **14p = 8** |
