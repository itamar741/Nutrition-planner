# Closed Food Catalog v0.1

Status: Turn 2 reviewed data record. Runtime code contains the same 17 entries in `src/data/food-catalog.ts`.

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

### Proteins

- `chicken-breast-roasted`; FDC 171477, SR Legacy; roasted skinless meat; 165 kcal, 31 g protein, 0 g carbohydrate, 3.57 g fat, 0 g fiber; ½ breast = 86 g; meat.
- `salmon-atlantic-cooked`; FDC 175168, SR Legacy; cooked dry heat; 206 kcal, 22.1 g protein, 0 g carbohydrate, 12.4 g fat, 0 g fiber; 3 oz = 85 g; neutral.
- `tofu-firm`; FDC 172448, SR Legacy; calcium-set firm tofu; 78 kcal, 9.04 g protein, 2.85 g carbohydrate, 4.17 g fat, 0.9 g fiber; ½ cup = 126 g; neutral.
- `greek-yogurt-nonfat`; FDC 170894, SR Legacy; plain nonfat; 59 kcal, 10.2 g protein, 3.6 g carbohydrate, 0.39 g fat, 0 g fiber; 1 container = 170 g; dairy.

### Fats

- `olive-oil`; FDC 171413, SR Legacy; salad or cooking oil; 884 kcal, 0 g protein, 0 g carbohydrate, 100 g fat, 0 g fiber; 1 tablespoon = 13.5 g; neutral.
- `avocado-raw`; FDC 171705, SR Legacy; raw; 160 kcal, 2 g protein, 8.53 g carbohydrate, 14.7 g fat, 6.7 g fiber; 1 serving = 50 g; neutral.
- `almonds-roasted`; FDC 323294, Foundation Foods; dry-roasted; 620 kcal, 20.4 g protein, 16.2 g carbohydrate, 57.8 g fat, 11 g fiber; 1 serving = 30 g; neutral.

### Vegetables

- `broccoli-raw`; FDC 747447, Foundation Foods; raw chopped; 31 kcal, 2.57 g protein, 6.27 g carbohydrate, 0.34 g fat, 2.4 g fiber; 1 cup = 76 g; neutral.
- `carrots-raw`; FDC 2258586, Foundation Foods; raw; 45 kcal, 0.941 g protein, 10.3 g carbohydrate, 0.351 g fat, 3.1 g fiber; 1 serving = 85 g; neutral.
- `spinach-raw`; FDC 1999633, Foundation Foods; mature raw leaves; 21.6 kcal, 2.91 g protein, 2.64 g carbohydrate, 0.604 g fat, 1.59 g fiber; 1 serving = 85 g; neutral.

### Fruits

- `banana-raw`; FDC 1105314, Foundation Foods; ripe raw peeled; 97 kcal, 0.74 g protein, 23 g carbohydrate, 0.29 g fat, 1.7 g fiber; 1 peeled banana = 115 g; neutral.
- `apple-fuji-raw`; FDC 1750340, Foundation Foods; raw with skin; 58.2 kcal, 0.148 g protein, 15.7 g carbohydrate, 0.162 g fat, 2.08 g fiber; 1 serving = 140 g; neutral.
- `blueberries-raw`; FDC 171711, SR Legacy; raw; 57 kcal, 0.74 g protein, 14.5 g carbohydrate, 0.33 g fat, 2.4 g fiber; 1 cup = 148 g; neutral.

## Manual Scope Review

Every entry is manually marked `kosherCatalogApproved: true` for this project's simplified demo catalog. This is not certification. The catalog excludes non-kosher foods, and deterministic meal validation rejects a meal that combines the `meat` and `dairy` classifications. Fish, tofu, produce, grains, oil, and nuts are `neutral` solely for this narrow within-meal check. No broader kashrut subsystem is implied.

Sources: [USDA FoodData Central Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/), [USDA FoodData Central downloadable data](https://fdc.nal.usda.gov/download-datasets/), [USDA FoodData Central API/data licensing guide](https://fdc.nal.usda.gov/api-guide/), and [FoodsDictionary — Willy Food wheat tortilla](https://www.foodsdictionary.co.il/Products/91/%D7%A2%D7%9C%D7%99%20%D7%98%D7%ור%D7%98%D7%99%D7%99%D7%94).
