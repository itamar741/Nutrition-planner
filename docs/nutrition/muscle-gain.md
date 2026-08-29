# Muscle Gain Nutrition Guidance v0.1

Status: Research-backed project guidance; ready for review, not medical advice.

## Scope and Shared Rules

This document applies only to the healthy-adult demo scope defined in the project framing. It does not prescribe exercise programming and does not claim that weight gain is muscle gain; the application tracks body weight only and has no body-composition measurement.

Use the exact shared EER equations, activity-category mapping, catalog method, 28-measurement trend method, and bounded adjustment mechanism defined in [Maintenance Nutrition Guidance](maintenance.md). This document changes only the goal-specific energy, protein, trend, and adjustment rules.

Evidence-based off-season bodybuilding guidance recommends a modest hyperenergetic intake, approximately 10–20% above maintenance, with a target gain around 0.25–0.5% body weight per week for novice and intermediate trainees. The source concerns bodybuilders, so the project uses the conservative lower end of its surplus range and treats the weight-rate band as a demo control—not proof that the gained mass is muscle. [Iraki et al., off-season bodybuilding review](https://pubmed.ncbi.nlm.nih.gov/31247944/)

## 1. Initial Energy Target

```text
muscle_gain_energy_target = round_to_25(EER × 1.10)
```

The 10% surplus is the lower end of the cited 10–20% range. This keeps the initial plan conservative and leaves later changes to the evidence-gated feedback loop.

## 2. Macronutrients and Fiber

A systematic review and meta-regression found no further average fat-free-mass benefit from protein supplementation beyond roughly 1.6 g/kg/day during resistance training, while noting uncertainty around the exact breakpoint. The project uses 1.6 g/kg/day as its planning target and accepts 1.6–2.0 g/kg/day. [Morton et al., systematic review and meta-regression](https://pubmed.ncbi.nlm.nih.gov/28698222/)

```text
protein_target_g = 1.6 × current_weight_kg
fat_target_kcal = 0.25 × muscle_gain_energy_target
fat_target_g = fat_target_kcal / 9
carbohydrate_target_g =
  (muscle_gain_energy_target - (4 × protein_target_g) - fat_target_kcal) / 4
fiber_minimum_g = 14 × muscle_gain_energy_target / 1000
```

## 3. Draft Acceptance

A Muscle Gain Draft passes only when all statements are true:

- Catalog energy is within ±5% of `muscle_gain_energy_target`.
- Protein is between 1.6 and 2.0 g/kg/day and within the age-appropriate AMDR: 10–30% at age 18 or 10–35% at age 19+.
- Fat is within the age-appropriate AMDR: 25–35% at age 18 or 20–35% at age 19+.
- Carbohydrate is between 45% and 65% of macro-derived energy.
- Fiber is at least `14 × target_kcal / 1000` grams/day.
- Every default food and alternative passes the shared catalog, approved-food, serving-unit, and meat/dairy rules.
- Selecting any displayed alternative keeps the complete day within these acceptance ranges.

The age-18 AMDR basis is carbohydrate 45–65%, fat 25–35%, and protein 10–30% of energy; at age 19+ it is carbohydrate 45–65%, fat 20–35%, and protein 10–35%. The DRI fiber basis is 14 g/1,000 kcal. [National Academies AMDR reference table](https://www.ncbi.nlm.nih.gov/books/NBK208874/), [Dietary fiber DRI summary](https://pubmed.ncbi.nlm.nih.gov/18953766/)

## 4. Weight Trend Band

Use the shared regression and evidence gate from [Maintenance Nutrition Guidance](maintenance.md). Express gain as a positive weekly percentage.

The Muscle Gain success band is **+0.25% to +0.50% body weight per week**, inclusive.

- Between +0.25% and +0.50%/week: propose no energy change.
- Slower than +0.25%/week, including maintenance or loss: permit an energy increase proposal.
- Faster than +0.50%/week: permit an energy decrease proposal.

Do not describe the trend as muscle growth. The application can say only that body weight is changing within, below, or above the selected goal's rate band.

## 5. Bounded Adjustment

Use the shared magnitude:

```text
adjustment_kcal = clamp(round_to_25(0.05 × active_plan_energy_kcal), 100, 200)
```

- Trend slower than the band → deterministic allowed change is `+adjustment_kcal`.
- Trend faster than the band → deterministic allowed change is `-adjustment_kcal`.

The AI may choose catalog-backed food changes that meet the allowed delta, but it cannot choose a different direction or magnitude. The proposal must preserve the protein range, all AMDR and fiber constraints, approved foods, and the meat/dairy rule. A proposal that fails deterministic validation is not shown as approvable. No proposal changes the Active Plan before explicit approval.

## 6. Reference Fixture

Use the shared reference input: male, age 30, height 180 cm, weight 80 kg, `low_active`; unrounded EER = 2945.77 kcal/day.

```text
muscle_gain_energy_target = round_to_25(2945.77 × 1.10)
                          = round_to_25(3240.347)
                          = 3250 kcal/day

protein_target = 1.6 × 80
               = 128 g/day

fat_target = (0.25 × 3250) / 9
           ≈ 90.28 g/day

carbohydrate_target = (3250 - (128 × 4) - (90.28 × 9)) / 4
                    ≈ 481.38 g/day

fiber_minimum = 14 × 3250 / 1000
              = 45.5 g/day
```

Trend boundary fixtures:

- `+0.25%/week` and `+0.50%/week` → no change.
- `+0.24%/week` → increase allowed.
- `+0.51%/week` → decrease allowed.

## Sources

- [Iraki et al.: nutrition recommendations for bodybuilders in the off-season](https://pubmed.ncbi.nlm.nih.gov/31247944/)
- [Morton et al.: protein supplementation and resistance-training meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/)
- [ISSN position stand: protein and exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/)
- [National Academies: AMDR reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [National Academies: Applications of the Dietary Reference Intakes for Energy](https://www.ncbi.nlm.nih.gov/books/NBK591020/)
