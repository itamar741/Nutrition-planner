# Closed Food Catalog v0.1

Status: Turn 2 reviewed data record. Runtime code contains the same 37 entries in `src/data/food-catalog.ts`.

## Source and Retrieval

The catalog was curated on 2026-08-30 from the official USDA FoodData Central downloads:

- Foundation Foods, April 2026 JSON release.
- SR Legacy, April 2018 final JSON release.

USDA FoodData Central is the primary nutrition source. Foundation Foods is preferred when the record contains all five project nutrients and a usable gram basis. SR Legacy is used where the required cooked/prepared form is absent from Foundation Foods or the Foundation record omits energy, protein, carbohydrate, fat, or fiber. One user-requested branded tortilla entry uses the Israeli FoodsDictionary product page as a secondary label source because a suitable whole-food USDA record was not available. No download, API request, search, manufacturer lookup, or AI-created nutrient value occurs at runtime.

For Foundation Foods without legacy nutrient `1008`, the catalog uses the published food-specific Atwater energy nutrient `2048`. All other stored values are the named per-100 g USDA values. Display portions are explicit gram conversions from the selected source record. Calculations always use grams, never the portion label.

## Catalog Records

Each row lists: internal ID; USDA FDC ID and dataset; preparation; kcal, protein, carbohydrate, fat, and fiber per 100 g; display portion; and meal classification.

### Carbohydrates

- `rolled-oats-dry`; FDC 173904, SR Legacy; dry; 379 kcal, 13.2 g protein, 67.7 g carbohydrate, 6.52 g fat, 10.1 g fiber; ⅓ cup = 27 g; neutral.
- `white-rice-cooked`; FDC 168878, SR Legacy; cooked; 130 kcal, 2.69 g protein, 28.2 g carbohydrate, 0.28 g fat, 0.4 g fiber; 1 cup = 158 g; neutral.
- `sweet-potato-baked`; FDC 168483, SR Legacy; baked flesh; 90 kcal, 2.01 g protein, 20.7 g carbohydrate, 0.15 g fat, 3.3 g fiber; 1 medium = 114 g; neutral.
- `tortilla-wheat-regular`; FoodsDictionary product page for Willy Food wheat tortilla; ready to eat; 290 kcal, 7 g protein, 55 g carbohydrate, 4 g fat, 0 g fiber; 1 tortilla = 45 g; neutral. The source page reports no fiber; this entry records 0 g for the selected product only.
- `potato-baked`; FDC 170033, SR Legacy; baked flesh without salt; 93 kcal, 1.96 g protein, 21.6 g carbohydrate, 0.1 g fat, 1.5 g fiber; 1 medium = 173 g; neutral.
- `pasta-cooked`; FDC 169751, SR Legacy; cooked enriched pasta; 157 kcal, 5.8 g protein, 30.6 g carbohydrate, 0.93 g fat, 1.8 g fiber; 1 cup = 140 g; neutral.
- `ptitim-cooked`; FoodsDictionary product page for Soget baked ptitim; cooked without added oil or salt; 184 kcal, 5.7 g protein, 39 g carbohydrate, 0.6 g fat, 0 g fiber; 1 cup = 150 g; neutral. The source page reports no fiber; this entry records 0 g for the selected product only.
- `couscous-cooked`; FDC 169700, SR Legacy; cooked; 112 kcal, 3.79 g protein, 23.2 g carbohydrate, 0.16 g fat, 1.4 g fiber; 1 cup = 157 g; neutral.
- `quinoa-cooked`; FDC 168917, SR Legacy; cooked; 120 kcal, 4.4 g protein, 21.3 g carbohydrate, 1.92 g fat, 2.8 g fiber; 1 cup = 185 g; neutral.
- `bulgur-cooked`; FDC 170287, SR Legacy; cooked; 83 kcal, 3.08 g protein, 18.6 g carbohydrate, 0.24 g fat, 4.5 g fiber; 1 cup = 182 g; neutral.
- `whole-wheat-bread`; FDC 172688, SR Legacy; commercially prepared; 252 kcal, 12.4 g protein, 42.7 g carbohydrate, 3.5 g fat, 6 g fiber; 1 slice = 28 g; neutral.
- `whole-wheat-pita`; FDC 174916, SR Legacy; ready to eat; 262 kcal, 9.8 g protein, 55.9 g carbohydrate, 1.71 g fat, 6.1 g fiber; 1 pita = 64 g; neutral.
- `lentils-cooked`; FDC 172421, SR Legacy; boiled without salt; 116 kcal, 9.02 g protein, 20.1 g carbohydrate, 0.38 g fat, 7.9 g fiber; ½ cup = 99 g; neutral.
- `rice-cake`; FDC 168107, SR Legacy; plain dry rice cake; 392 kcal, 7.1 g protein, 81.1 g carbohydrate, 4.3 g fat, 4.2 g fiber; 1 rice cake = 9 g; neutral.

### Proteins

- `chicken-breast-roasted`; FDC 171477, SR Legacy; roasted skinless meat; 165 kcal, 31 g protein, 0 g carbohydrate, 3.57 g fat, 0 g fiber; ½ breast = 86 g; meat.
- `salmon-atlantic-cooked`; FDC 175168, SR Legacy; cooked dry heat; 206 kcal, 22.1 g protein, 0 g carbohydrate, 12.4 g fat, 0 g fiber; 3 oz = 85 g; neutral.
- `tofu-firm`; FDC 172448, SR Legacy; calcium-set firm tofu; 78 kcal, 9.04 g protein, 2.85 g carbohydrate, 4.17 g fat, 0.9 g fiber; ½ cup = 126 g; neutral.
- `greek-yogurt-nonfat`; FDC 170894, SR Legacy; plain nonfat; 59 kcal, 10.2 g protein, 3.6 g carbohydrate, 0.39 g fat, 0 g fiber; 1 container = 170 g; dairy.

### Fats

- `olive-oil`; FDC 171413, SR Legacy; salad or cooking oil; 884 kcal, 0 g protein, 0 g carbohydrate, 100 g fat, 0 g fiber; 1 tablespoon = 13.5 g; neutral.
- `avocado-raw`; FDC 171705, SR Legacy; raw; 160 kcal, 2 g protein, 8.53 g carbohydrate, 14.7 g fat, 6.7 g fiber; 1 serving = 50 g; neutral.
- `almonds-roasted`; FDC 323294, Foundation Foods; dry-roasted; 620 kcal, 20.4 g protein, 16.2 g carbohydrate, 57.8 g fat, 11 g fiber; 1 serving = 30 g; neutral.
- `walnuts-english`; FDC 170187, SR Legacy; English walnuts; 654 kcal, 15.2 g protein, 13.7 g carbohydrate, 65.2 g fat, 6.7 g fiber; 1 serving = 30 g; neutral.
- `tahini-raw`; FDC 169410, SR Legacy; raw stone-ground sesame kernels; 570 kcal, 17.8 g protein, 26.2 g carbohydrate, 48 g fat, 9.3 g fiber; 1 tablespoon = 15 g; neutral.
- `peanut-butter-natural`; FDC 172470, SR Legacy; smooth peanut butter without added salt, used as the 100% natural catalog choice; 598 kcal, 22.2 g protein, 22.3 g carbohydrate, 51.4 g fat, 5 g fiber; 1 tablespoon = 16 g; neutral.

### Vegetables

- `broccoli-raw`; FDC 747447, Foundation Foods; raw chopped; 31 kcal, 2.57 g protein, 6.27 g carbohydrate, 0.34 g fat, 2.4 g fiber; 1 cup = 76 g; neutral.
- `carrots-raw`; FDC 2258586, Foundation Foods; raw; 45 kcal, 0.941 g protein, 10.3 g carbohydrate, 0.351 g fat, 3.1 g fiber; 1 serving = 85 g; neutral.
- `spinach-raw`; FDC 1999633, Foundation Foods; mature raw leaves; 21.6 kcal, 2.91 g protein, 2.64 g carbohydrate, 0.604 g fat, 1.59 g fiber; 1 serving = 85 g; neutral.
- `red-bell-pepper-raw`; FDC 170108, SR Legacy; raw; 26 kcal, 0.99 g protein, 6.03 g carbohydrate, 0.3 g fat, 2.1 g fiber; 1 medium pepper = 119 g; neutral.
- `cucumber-raw`; FDC 168409, SR Legacy; raw with peel; 15 kcal, 0.65 g protein, 3.63 g carbohydrate, 0.11 g fat, 0.5 g fiber; 1 medium cucumber = 201 g; neutral.
- `tomato-raw`; FDC 170457, SR Legacy; raw ripe tomato; 18 kcal, 0.88 g protein, 3.89 g carbohydrate, 0.2 g fat, 1.2 g fiber; 1 medium tomato = 123 g; neutral.

### Fruits

- `banana-raw`; FDC 1105314, Foundation Foods; ripe raw peeled; 97 kcal, 0.74 g protein, 23 g carbohydrate, 0.29 g fat, 1.7 g fiber; 1 peeled banana = 115 g; neutral.
- `apple-fuji-raw`; FDC 1750340, Foundation Foods; raw with skin; 58.2 kcal, 0.148 g protein, 15.7 g carbohydrate, 0.162 g fat, 2.08 g fiber; 1 serving = 140 g; neutral.
- `blueberries-raw`; FDC 171711, SR Legacy; raw; 57 kcal, 0.74 g protein, 14.5 g carbohydrate, 0.33 g fat, 2.4 g fiber; 1 cup = 148 g; neutral.
- `peach-raw`; FDC 169928, SR Legacy; raw yellow peach; 39 kcal, 0.91 g protein, 9.54 g carbohydrate, 0.25 g fat, 1.5 g fiber; 1 medium peach = 150 g; neutral.
- `strawberries-raw`; FDC 167762, SR Legacy; raw; 32 kcal, 0.67 g protein, 7.68 g carbohydrate, 0.3 g fat, 2 g fiber; 1 cup sliced = 166 g; neutral.
- `date-medjool`; FDC 168191, SR Legacy; raw pitted Medjool date; 277 kcal, 1.81 g protein, 75 g carbohydrate, 0.15 g fat, 6.7 g fiber; 1 date = 24 g; neutral.
- `pear-raw`; FDC 169118, SR Legacy; raw with skin; 57 kcal, 0.36 g protein, 15.2 g carbohydrate, 0.14 g fat, 3.1 g fiber; 1 medium pear = 178 g; neutral.

## Manual Scope Review

Every entry is manually marked `kosherCatalogApproved: true` for this project's simplified demo catalog. This is not certification. The catalog excludes non-kosher foods, and deterministic meal validation rejects a meal that combines the `meat` and `dairy` classifications. Fish, tofu, produce, grains, oil, and nuts are `neutral` solely for this narrow within-meal check. No broader kashrut subsystem is implied.

Sources: [USDA FoodData Central Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/), [USDA FoodData Central downloadable data](https://fdc.nal.usda.gov/download-datasets/), [USDA FoodData Central API/data licensing guide](https://fdc.nal.usda.gov/api-guide/), and [FoodsDictionary — Willy Food wheat tortilla](https://www.foodsdictionary.co.il/Products/91/%D7%A2%D7%9C%D7%99%20%D7%98%D7%ור%D7%98%D7%99%D7%99%D7%94).
