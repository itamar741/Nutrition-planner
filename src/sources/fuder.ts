import { createHash, randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import type {
  EstimatedFood,
  FoodLookupToolArguments,
  FoodSearchCandidate,
} from "@/domain/catalog/runtime";

const FUDER_ORIGIN = "https://www.fuder.co.il";

export class FuderUnavailableError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_configured"
      | "timeout"
      | "blocked"
      | "no_results"
      | "malformed_source",
  ) {
    super(message);
  }
}

function safeFuderFoodUrl(value: string) {
  const url = new URL(value, FUDER_ORIGIN);
  if (
    !["fuder.co.il", "www.fuder.co.il"].includes(url.hostname) ||
    !url.pathname.startsWith("/foods/")
  ) {
    return null;
  }
  url.hash = "";
  return url.toString();
}

async function scrapingBeeRequest(
  targetUrl: string,
  options: { renderJs: boolean; scenario?: Record<string, unknown> },
) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    throw new FuderUnavailableError(
      "ScrapingBee is not configured.",
      "not_configured",
    );
  }
  const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("url", targetUrl);
  endpoint.searchParams.set("render_js", String(options.renderJs));
  endpoint.searchParams.set("block_resources", "true");
  if (options.scenario) {
    endpoint.searchParams.set("js_scenario", JSON.stringify(options.scenario));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      cache: "no-store",
    });
    if ([401, 403, 429].includes(response.status)) {
      throw new FuderUnavailableError(
        "The source or lookup service blocked this request.",
        "blocked",
      );
    }
    if (!response.ok) {
      throw new FuderUnavailableError(
        `The source lookup failed with status ${response.status}.`,
        "malformed_source",
      );
    }
    return await response.text();
  } catch (error) {
    if (error instanceof FuderUnavailableError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FuderUnavailableError(
        "The source lookup timed out.",
        "timeout",
      );
    }
    throw new FuderUnavailableError(
      "The source lookup was unavailable.",
      "malformed_source",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseFuderSearchResults(html: string): FoodSearchCandidate[] {
  const $ = cheerio.load(html);
  const results: FoodSearchCandidate[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, element) => {
    if (results.length >= 5) return;
    const sourceUrl = safeFuderFoodUrl($(element).attr("href") ?? "");
    if (!sourceUrl || seen.has(sourceUrl)) return;
    const title = $(element).text().replace(/\s+/g, " ").trim();
    if (!title || title.length > 200) return;
    seen.add(sourceUrl);
    const description = $(element)
      .closest("article, li, div")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    results.push({ id: randomUUID(), title, description, sourceUrl });
  });
  return results;
}

function numberAfterLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const expression = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^0-9]{0,40}([0-9]+(?:[.,][0-9]+)?)`,
      "i",
    );
    const match = text.match(expression);
    if (match) return Number(match[1].replace(",", "."));
  }
  return null;
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function numericCell(value: string) {
  const match = value.replace(/,/g, ".").match(/-?[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : null;
}

function isPer100GramHeader(value: string) {
  const text = normalizedText(value);
  return /100\s*(?:גר(?:ם)?|ג׳|ג'|g)(?:\s|$)/i.test(text);
}

function rowValue(rows: string[][], valueIndex: number, labels: string[]) {
  const row = rows.find((cells) => {
    const label = normalizedText(cells[0] ?? "");
    return labels.some((candidate) => label.includes(candidate));
  });
  return row ? numericCell(row[valueIndex] ?? "") : null;
}

function practicalServingFromHeaders(headers: string[], per100Index: number) {
  for (let index = 1; index < headers.length; index += 1) {
    if (index === per100Index) continue;
    const label = normalizedText(headers[index] ?? "");
    const quantity = label.match(
      /\(([0-9]+(?:[.,][0-9]+)?)\s*(?:גר(?:ם)?|ג׳|ג'|מ[״\"]?ל|מל|ml)\)/i,
    );
    if (!quantity) continue;
    return {
      label,
      grams: Number(quantity[1].replace(",", ".")),
    };
  }
  return { label: "100 g", grams: 100 };
}

function parseNutritionTable($: cheerio.CheerioAPI) {
  for (const table of $("table").toArray()) {
    const rows = $(table)
      .find("tr")
      .toArray()
      .map((row) =>
        $(row)
          .find("th, td")
          .toArray()
          .map((cell) => normalizedText($(cell).text())),
      )
      .filter((cells) => cells.length > 1);
    const header = rows.find((cells) =>
      cells.some((cell) => isPer100GramHeader(cell)),
    );
    if (!header) continue;
    const per100Index = header.findIndex((cell) => isPer100GramHeader(cell));
    const energyKcal = rowValue(rows, per100Index, ["אנרגיה", "קלוריות"]);
    const proteinG = rowValue(rows, per100Index, ["חלבון"]);
    const carbohydrateG = rowValue(rows, per100Index, ["פחמימה"]);
    const fatG = rowValue(rows, per100Index, ["שומן", "שומנים"]);
    const fiberG = rowValue(rows, per100Index, ["סיבים"]);
    if (
      energyKcal === null ||
      proteinG === null ||
      carbohydrateG === null ||
      fatG === null
    ) {
      continue;
    }
    return {
      energyKcal,
      proteinG,
      carbohydrateG,
      fatG,
      fiberG,
      displayPortion: practicalServingFromHeaders(header, per100Index),
    };
  }
  return null;
}

function parseBrand($: cheerio.CheerioAPI) {
  for (const element of $("body *").toArray()) {
    const ownText = normalizedText(
      $(element).clone().children().remove().end().text(),
    );
    const match = ownText.match(/^מותג\s*:\s*(.+)$/);
    if (match?.[1]) return normalizedText(match[1]).slice(0, 80);
  }
  return null;
}

export function parseFuderFoodPage(html: string) {
  const $ = cheerio.load(html);
  const title = normalizedText($("h1").first().text()).replace(
    /\s*[—–-]\s*קלוריות.*$/,
    "",
  );
  const fullText = normalizedText($("body").text());
  const tableNutrition = parseNutritionTable($);
  const explicitlyPer100g = /(?:ל|ב)[-־]?\s*100\s*גר(?:ם)?/i.test(fullText);
  const energyKcal =
    tableNutrition?.energyKcal ??
    (explicitlyPer100g
      ? numberAfterLabel(fullText, ["קלוריות", "אנרגיה"])
      : null);
  const proteinG =
    tableNutrition?.proteinG ??
    (explicitlyPer100g
      ? numberAfterLabel(fullText, ["חלבונים", "חלבון"])
      : null);
  const carbohydrateG =
    tableNutrition?.carbohydrateG ??
    (explicitlyPer100g
      ? numberAfterLabel(fullText, ["פחמימות", "פחמימה"])
      : null);
  const fatG =
    tableNutrition?.fatG ??
    (explicitlyPer100g ? numberAfterLabel(fullText, ["שומנים", "שומן"]) : null);
  const fiberG =
    tableNutrition?.fiberG ??
    (explicitlyPer100g
      ? numberAfterLabel(fullText, ["סיבים תזונתיים", "סיבים"])
      : null);
  if (
    !title ||
    energyKcal === null ||
    proteinG === null ||
    carbohydrateG === null ||
    fatG === null
  ) {
    throw new FuderUnavailableError(
      "Fuder did not expose the expected nutrition fields.",
      "malformed_source",
    );
  }
  return {
    title,
    brand: parseBrand($),
    energyKcal,
    proteinG,
    carbohydrateG,
    fatG,
    fiberG,
    displayPortion: tableNutrition?.displayPortion ?? {
      label: "100 g",
      grams: 100,
    },
  };
}

export function validateNutritionPlausibility(food: EstimatedFood) {
  const macroEnergy =
    food.proteinG * 4 + food.carbohydrateG * 4 + food.fatG * 9;
  const tolerance = Math.max(35, food.energyKcal * 0.35);
  if (Math.abs(food.energyKcal - macroEnergy) > tolerance) {
    throw new FuderUnavailableError(
      "The source nutrition values were internally inconsistent.",
      "malformed_source",
    );
  }
  return food;
}

export async function searchFuder(
  input: FoodLookupToolArguments,
): Promise<FoodSearchCandidate[]> {
  const searchUrl = new URL(FUDER_ORIGIN);
  searchUrl.searchParams.set(
    "s",
    [input.query, input.brand].filter(Boolean).join(" "),
  );
  const html = await scrapingBeeRequest(searchUrl.toString(), {
    renderJs: true,
    scenario: {
      instructions: [{ wait_for: "body" }, { wait: 1500 }],
    },
  });
  const results = parseFuderSearchResults(html);
  if (results.length === 0) {
    throw new FuderUnavailableError(
      "No matching Fuder foods were found.",
      "no_results",
    );
  }
  return results;
}

export async function fetchFuderFood(sourceUrl: string) {
  const safeUrl = safeFuderFoodUrl(sourceUrl);
  if (!safeUrl) {
    throw new FuderUnavailableError(
      "The selected result is not a Fuder food page.",
      "malformed_source",
    );
  }
  return parseFuderFoodPage(
    await scrapingBeeRequest(safeUrl, { renderJs: false }),
  );
}

export function dynamicFoodId(sourceIdentifier: string) {
  return `runtime-${createHash("sha256").update(sourceIdentifier).digest("hex").slice(0, 16)}`;
}
