# Maintenance Nutrition Guidance v0.1

Status: Research-backed project guidance; ready for review, not medical advice.

## Scope

This document defines the shared deterministic nutrition foundation and the Maintenance-specific rules for the two demo profiles. It applies only to the project's healthy-adult demonstration scope: age 18 or older, exercising, not pregnant or lactating, and without medical or clinical nutrition needs. The product does not screen or plan for conditions outside that scope.

The National Academies describes individual energy planning as a two-step process: calculate an initial Estimated Energy Requirement (EER), then monitor body weight and adjust intake incrementally because actual individual requirements can differ materially from the prediction. That is the exact model used here: an estimate first, then a controlled weight-feedback loop. [National Academies, Applications of the DRIs for Energy](https://www.ncbi.nlm.nih.gov/books/NBK591020/)

## 1. Shared Initial Energy Estimate

### Required Inputs

- Age in completed years.
- Sex used for the physiological EER equation: male or female.
- Height in centimeters.
- Current weight in kilograms.
- Daily-routine category: `mostly_seated`, `mixed_or_on_feet`, or `physically_demanding`.
- Weekly moderate-intensity, vigorous-intensity, and resistance-training minutes derived from exercise type, frequency, and duration.

If any required value is absent or invalid, the system does not calculate an energy target or create a Draft.

### Project Mapping to a PAL Category

The 2023 EER equations require one of four physical activity level (PAL) categories: inactive, low active, active, or very active. The National Academies notes that selecting the category is the most challenging part and defines the categories from PAL distributions rather than a simple questionnaire. The project therefore uses a transparent deterministic approximation from the concrete routine and exercise data collected in onboarding; it does not claim that this heuristic directly measures PAL. [National Academies, selecting a PAL category](https://www.ncbi.nlm.nih.gov/books/NBK591020/)

Calculate weekly moderate-equivalent minutes as:

```text
moderate_equivalent_minutes =
  moderate_minutes
  + (2 × vigorous_minutes)
  + resistance_training_minutes
```

The 2:1 vigorous conversion follows the federal adult-activity equivalence of 150–300 minutes of moderate activity or 75–150 minutes of vigorous activity per week. Resistance-training minutes count as moderate-equivalent for this project unless the structured exercise type explicitly identifies vigorous conditioning. [Physical Activity Guidelines for Americans](https://stacks.cdc.gov/view/cdc/121857)

Assign a routine score:

- `mostly_seated` = 0
- `mixed_or_on_feet` = 1
- `physically_demanding` = 2

Assign an exercise score:

- less than 150 moderate-equivalent minutes/week = 0
- 150–299 minutes/week = 1
- 300 minutes/week or more = 2

Map the sum to the EER category:

- score 0 = `inactive`
- score 1 = `low_active`
- score 2 or 3 = `active`
- score 4 = `very_active`

This mapping is a project operational decision anchored to published activity-duration thresholds. It must be stored as deterministic code and tested with boundary fixtures; the AI may extract the inputs but may not choose or override the final category.

### EER Equations

Use the 2023 National Academies equations. Age is in years, height is in centimeters, weight is in kilograms, and the result is kcal/day. The source equations were developed from total-energy-expenditure data measured primarily with doubly labeled water. [National Academies, 2023 EER summary tables](https://www.ncbi.nlm.nih.gov/books/NBK591034/)

For age 18 through 18.99, use the adolescent equations and the included 20 kcal/day growth allowance.

Male, age 18:

```text
inactive:   EER = -447.51 + (3.68 × age) + (13.01 × height) + (13.15 × weight) + 20
low_active: EER =   19.12 + (3.68 × age) + ( 8.62 × height) + (20.28 × weight) + 20
active:     EER = -388.19 + (3.68 × age) + (12.66 × height) + (20.46 × weight) + 20
very_active:EER = -671.75 + (3.68 × age) + (15.38 × height) + (23.25 × weight) + 20
```

Female, age 18:

```text
inactive:   EER =   55.59 - (22.25 × age) + ( 8.43 × height) + (17.07 × weight) + 20
low_active: EER = -297.54 - (22.25 × age) + (12.77 × height) + (14.73 × weight) + 20
active:     EER = -189.55 - (22.25 × age) + (11.74 × height) + (18.34 × weight) + 20
very_active:EER = -709.59 - (22.25 × age) + (18.22 × height) + (14.25 × weight) + 20
```

For age 19 and older, use the adult equations.

Male, age 19+:

```text
inactive:   EER =  753.07 - (10.83 × age) + ( 6.50 × height) + (14.10 × weight)
low_active: EER =  581.47 - (10.83 × age) + ( 8.30 × height) + (14.94 × weight)
active:     EER = 1004.82 - (10.83 × age) + ( 6.52 × height) + (15.91 × weight)
very_active:EER = -517.88 - (10.83 × age) + (15.61 × height) + (19.11 × weight)
```

Female, age 19+:

```text
inactive:   EER = 584.90 - (7.01 × age) + (5.72 × height) + (11.71 × weight)
low_active: EER = 575.77 - (7.01 × age) + (6.60 × height) + (12.14 × weight)
active:     EER = 710.25 - (7.01 × age) + (6.54 × height) + (12.34 × weight)
very_active:EER = 511.83 - (7.01 × age) + (9.07 × height) + (12.56 × weight)
```

Round the goal-adjusted energy target, not the raw EER, to the nearest 25 kcal using half-up rounding.

## 2. Maintenance Targets

### Energy

```text
maintenance_energy_target = round_to_25(EER)
```

Maintenance is an operational weight-stability goal, not a claim that the prediction exactly equals the individual's expenditure.

### Macronutrients and Fiber

The ISSN position stand places most exercising adults at approximately 1.4–2.0 g protein/kg/day. This project selects 1.6 g/kg/day as the Maintenance planning target. [ISSN position stand: protein and exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/)

```text
protein_target_g = 1.6 × current_weight_kg
fat_target_kcal = 0.25 × maintenance_energy_target
fat_target_g = fat_target_kcal / 9
carbohydrate_target_g =
  (maintenance_energy_target - (4 × protein_target_g) - fat_target_kcal) / 4
fiber_minimum_g = 14 × maintenance_energy_target / 1000
```

The deterministic validator must enforce age-appropriate Acceptable Macronutrient Distribution Ranges (AMDRs). At age 18: carbohydrate 45–65% of macro-derived energy, fat 25–35%, and protein 10–30%. At age 19 and older: carbohydrate 45–65%, fat 20–35%, and protein 10–35%. Fiber uses the DRI basis of 14 g per 1,000 kcal. [National Academies AMDR reference table](https://www.ncbi.nlm.nih.gov/books/NBK208874/), [Dietary fiber DRI summary](https://pubmed.ncbi.nlm.nih.gov/18953766/)

### Plan Acceptance Ranges

A Maintenance Draft passes only when all statements are true:

- Catalog energy is within ±5% of `maintenance_energy_target`.
- Protein is between 1.4 and 2.0 g/kg/day and within the age-appropriate AMDR: 10–30% at age 18 or 10–35% at age 19+.
- Fat is within the age-appropriate AMDR: 25–35% at age 18 or 20–35% at age 19+.
- Carbohydrate is between 45% and 65% of macro-derived energy.
- Fiber is at least `14 × target_kcal / 1000` grams/day.
- Every plan food and interchangeable choice resolves to an approved catalog entry.
- Replacing a default item with any displayed alternative still passes the daily energy, protein, fat, carbohydrate, fiber, catalog, and meat/dairy checks.
- No meal contains both a `meat` and a `dairy` catalog classification.

For AMDR percentages, calculate macro-derived energy as `4 × protein_g + 4 × carbohydrate_g + 9 × fat_g`. For the plan's total energy tolerance, use the catalog energy values rather than silently replacing them with the 4/4/9 result.

If the protein target and AMDR constraints cannot all be satisfied for a demo fixture, the fixture is invalid; the system must not quietly relax a rule.

## 3. Shared Food Catalog Method

The Food Catalog is prepared before runtime. Prefer USDA FoodData Central Foundation Foods, then SR Legacy when the required common food is absent. Foundation Foods documents nutrient values per 100 g of edible portion and provides gram weights for household portions. [USDA FoodData Central Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)

Each catalog entry must store:

- stable internal identifier and display name;
- USDA FDC identifier or a documented manufacturer-label source for a packaged item such as protein powder;
- source dataset and retrieval date;
- preparation state, such as raw, cooked, or drained;
- energy, protein, carbohydrate, fat, and fiber per 100 g edible portion;
- one or more display portions with an explicit gram conversion;
- category: carbohydrate, protein, fat, vegetable, or fruit;
- meal classification: `neutral`, `meat`, or `dairy`; and
- `kosher_catalog_approved: true` after manual project curation.

All calculations use grams internally:

```text
nutrient_for_portion = nutrient_per_100g × portion_grams / 100
```

Baseline source data is reviewed and copied into the curated catalog during data authoring. The deployed application permits one narrow exception for a user-requested food or packaged product: the Next.js server may use the bounded ScrapingBee/Fuder adapter to create a source-labelled candidate. The user must select the result and explicitly approve it before it becomes a catalog entry. The adapter reads the explicit per-100-g table column and stores a separate practical serving; it never treats a package total as a per-100-g value. Fuder's [methodology](https://www.fuder.co.il/%D7%9E%D7%A7%D7%95%D7%A8%D7%95%D7%AA-%D7%95%D7%9E%D7%AA%D7%95%D7%93%D7%95%D7%9C%D7%95%D7%92%D7%99%D7%94/) may omit unavailable nutrients, so missing fiber remains `null` rather than becoming zero. The adapter cannot bulk crawl, log in, bypass access controls, or pass raw source content to the model. If no valid source candidate is available, an AI-created value may be shown only as `AI estimate · Fuder not verified` and requires the same approval. Neither source path may change an Active Plan directly.

## 4. Shared Weight Trend and Evidence Rule

Body weight has meaningful day-to-day variability; a study of standardized measurements reported roughly 0.53% standard deviation over a one-day interval. A single new value must therefore never determine a plan change. [Day-to-day variability in body mass](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/)

Research using longitudinal weight measurements found that frequent measurements over more than 28 days were needed for relatively precise inference about energy-intake change. The project does not attempt that paper's full energy-intake inference; it adopts a conservative 28-measurement evidence gate for its simpler trend classification. [Hall and Chow, estimating changes in free-living energy intake](https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/)

### Input Rules

- Normalize all stored values to kilograms.
- Accept at most one confirmed weight per calendar date.
- A retry with the same command identifier is idempotent.
- Do not silently delete statistical outliers; the demo fixture and entered value must be valid before storage.

### Sufficient Evidence

Evidence is sufficient only if all statements are true:

- At least 28 valid, unique-date measurements exist within the most recent 35 calendar days.
- The included measurements span at least 28 days from earliest to latest.
- The same Active Plan has been unchanged for the entire span.
- The newest confirmed weight is included.

After an Active Plan adjustment, the evidence gate resets until a new qualifying unchanged-plan window exists.

### Trend Calculation

1. Select every valid measurement within the most recent 35 calendar days.
2. Convert each date to elapsed days from the first included date.
3. Fit ordinary least-squares linear regression with weight in kilograms as the dependent value and elapsed days as the independent value.
4. Calculate:

```text
weekly_change_kg = slope_kg_per_day × 7
mean_weight_kg = arithmetic mean of included weights
weekly_change_percent = (weekly_change_kg / mean_weight_kg) × 100
```

Store and show the included date range, measurement count, slope, weekly kg change, weekly percentage change, and evidence result. Round only for display; comparisons use unrounded values.

### Maintenance Trend Band

The Maintenance success band is a project operational tolerance of **-0.25% to +0.25% body weight per week**, inclusive. It represents practical stability in the demo rather than a universal clinical definition.

- Within the band: propose no energy change.
- Above +0.25%/week: permit a decrease proposal.
- Below -0.25%/week: permit an increase proposal.

## 5. Shared Bounded Adjustment Rule

When sufficient evidence exists and the trend is outside the goal band, deterministic code—not the AI—sets the allowed direction and energy magnitude:

```text
raw_adjustment_kcal = 0.05 × active_plan_energy_kcal
rounded_adjustment_kcal = round_to_25(raw_adjustment_kcal)
adjustment_kcal = clamp(rounded_adjustment_kcal, 100, 200)
```

For Maintenance:

- trend above the band → allowed change is `-adjustment_kcal`;
- trend below the band → allowed change is `+adjustment_kcal`.

The 5%, 100–200 kcal bounds are conservative project controls, not values directly prescribed by the cited literature. The National Academies supports incremental adjustment after monitoring, while dynamic body-weight research warns that simple static calorie-to-weight rules do not capture physiological adaptation. [National Academies incremental adjustment](https://www.ncbi.nlm.nih.gov/books/NBK591020/), [Hall et al., dynamic body-weight response](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/)

The AI receives the allowed direction and exact bounded energy change. It may propose catalog-food changes that realize that target, but it may not change the direction or magnitude. Protein remains within the goal-specific range, fat and carbohydrate remain within AMDR, fiber remains at or above its minimum, and deterministic validation must pass before the proposal is shown. The Active Plan remains unchanged until explicit approval.

## 6. Reference Fixture

This arithmetic fixture is a verification reference, not one of the application profiles.

Input: male, age 30, height 180 cm, weight 80 kg, `low_active`.

```text
EER = 581.47 - (10.83 × 30) + (8.30 × 180) + (14.94 × 80)
    = 2945.77 kcal/day

maintenance_energy_target = round_to_25(2945.77)
                          = 2950 kcal/day

protein_target = 1.6 × 80
               = 128 g/day

fat_target = (0.25 × 2950) / 9
           = 81.94 g/day

carbohydrate_target = (2950 - (128 × 4) - (81.94 × 9)) / 4
                    ≈ 425.13 g/day

fiber_minimum = 14 × 2950 / 1000
              = 41.3 g/day
```

The implementation test must reproduce the unrounded intermediate values and the stated rounded target.

## Sources

- [National Academies: Dietary Reference Intakes for Energy, 2023](https://www.ncbi.nlm.nih.gov/books/NBK591034/)
- [National Academies: Applications of the Dietary Reference Intakes for Energy](https://www.ncbi.nlm.nih.gov/books/NBK591020/)
- [National Academies: AMDR reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [Physical Activity Guidelines for Americans, second edition](https://stacks.cdc.gov/view/cdc/121857)
- [ISSN position stand: protein and exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/)
- [USDA FoodData Central Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)
- [Hall and Chow: estimating changes in free-living energy intake](https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/)
- [Hall et al.: quantification of energy imbalance and body weight](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/)
- [Day-to-day variability in body mass](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/)
