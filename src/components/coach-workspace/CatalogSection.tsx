import { foodCategoryLabels, foodCategoryOrder } from "@/data/food-catalog";
import type { CatalogFood } from "@/domain/catalog/types";
import styles from "./CoachWorkspace.module.css";

export function CatalogSection({
  approvedIds,
  catalog,
}: {
  approvedIds: string[];
  catalog: readonly CatalogFood[];
}) {
  const approvedFoods = catalog.filter((food) => approvedIds.includes(food.id));
  return (
    <article className={styles.catalogCard}>
      <span>This demo profile’s food preferences</span>
      <h3>{approvedFoods.length} approved foods</h3>
      <p>
        These are the foods this demo user said they like. Plans can use only
        this subset, not every food in the catalog.
      </p>
      <div className={styles.catalogGroups}>
        {foodCategoryOrder.map((category) => (
          <section key={category}>
            <h4>{foodCategoryLabels[category]}</h4>
            <ul>
              {approvedFoods
                .filter((food) => food.category === category)
                .map((food) => (
                  <li key={food.id}>{food.displayName}</li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
