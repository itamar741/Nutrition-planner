import { foodCategoryLabels, foodCategoryOrder } from "@/data/food-catalog";
import type { CatalogFood } from "@/domain/catalog/types";
import styles from "./CoachWorkspace.module.css";

interface FoodGridProps {
  catalog: readonly CatalogFood[];
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
  onSubmit: () => void;
}

export function FoodGrid({
  catalog,
  selectedIds,
  disabled,
  onToggle,
  onSubmit,
}: FoodGridProps) {
  const catalogById = new Map(catalog.map((food) => [food.id, food]));
  const missingCategories = foodCategoryOrder.filter(
    (category) =>
      !selectedIds.some((id) => catalogById.get(id)?.category === category),
  );
  const complete = missingCategories.length === 0;

  return (
    <section className={styles.foodGrid} aria-label="Food preferences">
      <div className={styles.foodGridIntro}>
        <div>
          <p className={styles.kicker}>Closed food catalog</p>
          <h2>Choose at least one from every group.</h2>
        </div>
        <span>{selectedIds.length} selected</span>
      </div>
      <p className={styles.foodGridHint}>
        Choose more if you want the coach to have more flexibility. Only these
        reviewed foods can appear in your plan.
      </p>
      <div className={styles.foodGroups}>
        {foodCategoryOrder.map((category) => (
          <fieldset className={styles.foodGroup} key={category}>
            <legend>{foodCategoryLabels[category]}</legend>
            <div className={styles.foodOptions}>
              {catalog
                .filter((food) => food.category === category)
                .map((food) => {
                  const selected = selectedIds.includes(food.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`${styles.foodOption} ${
                        selected ? styles.foodOptionSelected : ""
                      }`}
                      disabled={disabled}
                      key={food.id}
                      onClick={() => onToggle(food.id)}
                      type="button"
                    >
                      <span className={styles.foodCheck} aria-hidden="true">
                        {selected ? "✓" : "+"}
                      </span>
                      <span>
                        <strong>{food.displayName}</strong>
                        <small>{food.preparation}</small>
                      </span>
                    </button>
                  );
                })}
            </div>
          </fieldset>
        ))}
      </div>
      {!complete ? (
        <p className={styles.foodMissing} role="status">
          Still needed:{" "}
          {missingCategories
            .map((category) => foodCategoryLabels[category])
            .join(", ")}
          .
        </p>
      ) : (
        <p className={styles.foodReady}>All five groups are covered.</p>
      )}
      <button
        className={styles.primaryAction}
        disabled={disabled || !complete}
        onClick={onSubmit}
        type="button"
      >
        Save food preferences
      </button>
    </section>
  );
}
