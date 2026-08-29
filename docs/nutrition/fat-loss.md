# Fat Loss Nutrition Guidance v0.1

Status: Research-backed project guidance; ready for review, not medical advice.

## Scope and Shared Rules

This document applies only to the healthy-adult demo scope defined in the project framing. It does not cover medical weight management, eating disorders, pregnancy or lactation, allergies, intolerances, or clinical nutrition.

Use the exact shared EER equations, activity-category mapping, catalog method, 28-measurement trend method, and bounded adjustment mechanism defined in [Maintenance Nutrition Guidance](maintenance.md). This document changes only the goal-specific energy, protein, trend, and adjustment rules.

Fat loss requires a sustained energy deficit. The ISSN body-composition position stand notes that slower loss can better preserve lean mass in leaner subjects, and an evidence review for resistance-trained natural bodybuilders recommends approximately 0.5–1.0% body weight loss per week. The latter population is more specialized than this project's beginners, so the project uses that range as a conservative observable demo band rather than a clinical promise. [ISSN diets and body composition](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/), [Helms et al., contest-preparation review](https://jissn.biomedcentral.com/articles/10.1186/1550-2783-11-20)

## 1. Initial Energy Target

```text
fat_loss_energy_target = round_to_25(EER × 0.85)
```

The initial 15% deficit is a project choice intended to begin moderately, observe the weight trend, and adjust incrementally rather than assuming the estimate is exact. It sits below more aggressive 500–750 kcal/day clinical trial prescriptions and avoids applying one absolute deficit across all body sizes. [NHLBI evidence review](https://www.nhlbi.nih.gov/sites/default/files/media/docs/obesity-evidence-review.pdf), [National Academies individual EER application](https://www.ncbi.nlm.nih.gov/books/NBK591020/)

The two committed demo fixtures must produce a target compatible with all macro ranges. If they do not, the fixture or product scope must be reviewed; the system may not silently lower targets or relax nutrition validation.

## 2. Macronutrients and Fiber

Most exercising adults are supported by approximately 1.4–2.0 g protein/kg/day. Energy restriction can increase the value of higher protein intake for lean-mass retention; evidence in very lean resistance-trained athletes is often expressed per kilogram of fat-free mass, which this project does not collect. The project therefore selects a moderate 1.8 g/kg body-weight target and retains the ISSN 1.4–2.0 range as its outer evidence boundary. [ISSN protein position stand](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/), [ISSN diets and body composition](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/)

```text
protein_target_g = 1.8 × current_weight_kg
fat_target_kcal = 0.25 × fat_loss_energy_target
fat_target_g = fat_target_kcal / 9
carbohydrate_target_g =
  (fat_loss_energy_target - (4 × protein_target_g) - fat_target_kcal) / 4
fiber_minimum_g = 14 × fat_loss_energy_target / 1000
```

## 3. Draft Acceptance

A Fat Loss Draft passes only when all statements are true:

- Catalog energy is within ±5% of `fat_loss_energy_target`.
- Protein is between 1.6 and 2.0 g/kg/day and within the age-appropriate AMDR: 10–30% at age 18 or 10–35% at age 19+.
- Fat is within the age-appropriate AMDR: 25–35% at age 18 or 20–35% at age 19+.
- Carbohydrate is between 45% and 65% of macro-derived energy.
- Fiber is at least `14 × target_kcal / 1000` grams/day.
- Every default food and alternative passes the shared catalog, approved-food, serving-unit, and meat/dairy rules.
- Selecting any displayed alternative keeps the complete day within these acceptance ranges.

The age-18 AMDR basis is carbohydrate 45–65%, fat 25–35%, and protein 10–30% of energy; at age 19+ it is carbohydrate 45–65%, fat 20–35%, and protein 10–35%. The DRI fiber basis is 14 g/1,000 kcal. [National Academies AMDR reference table](https://www.ncbi.nlm.nih.gov/books/NBK208874/), [Dietary fiber DRI summary](https://pubmed.ncbi.nlm.nih.gov/18953766/)

## 4. Weight Trend Band

Use the shared regression and evidence gate from [Maintenance Nutrition Guidance](maintenance.md). Express loss as a negative weekly percentage.

The Fat Loss success band is **-1.00% to -0.50% body weight per week**, inclusive.

- Between -1.00% and -0.50%/week: propose no energy change.
- Slower than -0.50%/week, including maintenance or gain: permit an energy decrease proposal.
- Faster than -1.00%/week: permit an energy increase proposal.

Do not make any evidence-based energy proposal without at least 28 qualifying measurements spanning at least 28 days under the same Active Plan. A single measurement or one week of change is insufficient.

## 5. Bounded Adjustment

Use the shared magnitude:

```text
adjustment_kcal = clamp(round_to_25(0.05 × active_plan_energy_kcal), 100, 200)
```

- Trend slower than the band → deterministic allowed change is `-adjustment_kcal`.
- Trend faster than the band → deterministic allowed change is `+adjustment_kcal`.

The AI may choose catalog-backed food changes that meet the allowed delta, but it cannot choose a different direction or magnitude. The proposal must preserve at least 1.6 g/kg protein, all AMDR and fiber constraints, approved foods, and the meat/dairy rule. A proposal that fails deterministic validation is not shown as approvable. No proposal changes the Active Plan before explicit approval.

## 6. Reference Fixture

Use the shared reference input: male, age 30, height 180 cm, weight 80 kg, `low_active`; unrounded EER = 2945.77 kcal/day.

```text
fat_loss_energy_target = round_to_25(2945.77 × 0.85)
                       = round_to_25(2503.9045)
                       = 2500 kcal/day

protein_target = 1.8 × 80
               = 144 g/day

fat_target = (0.25 × 2500) / 9
           ≈ 69.44 g/day

carbohydrate_target = (2500 - (144 × 4) - (69.44 × 9)) / 4
                    ≈ 324.75 g/day

fiber_minimum = 14 × 2500 / 1000
              = 35 g/day
```

Trend boundary fixtures:

- `-0.50%/week` and `-1.00%/week` → no change.
- `-0.49%/week` → decrease allowed.
- `-1.01%/week` → increase allowed.

## Sources

- [ISSN position stand: diets and body composition](https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/)
- [Helms et al.: evidence-based bodybuilding contest preparation](https://jissn.biomedcentral.com/articles/10.1186/1550-2783-11-20)
- [ISSN position stand: protein and exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/)
- [National Academies: AMDR reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [National Academies: Applications of the Dietary Reference Intakes for Energy](https://www.ncbi.nlm.nih.gov/books/NBK591020/)
- [NHLBI: evidence review for adult weight management](https://www.nhlbi.nih.gov/sites/default/files/media/docs/obesity-evidence-review.pdf)
