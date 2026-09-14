import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addExistingFoodToProfile,
  StaleProfileError,
} from "@/persistence/repository";
import { requestHasAccess } from "@/security/demo-access";

export const runtime = "nodejs";

const schema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    foodId: z.string().min(1).max(100),
    expectedVersion: z.number().int().positive(),
    commandId: z.string().min(8).max(100),
  })
  .strict();

export async function POST(request: Request) {
  if (!requestHasAccess(request)) {
    return NextResponse.json(
      { ok: false, message: "Demo access is required." },
      { status: 401 },
    );
  }
  try {
    const input = schema.parse(await request.json());
    const result = await addExistingFoodToProfile(input);
    return NextResponse.json({
      ok: true,
      ...result,
      message: `${result.food.displayName} was added to this profile's approved foods.`,
    });
  } catch (error) {
    if (error instanceof StaleProfileError) {
      return NextResponse.json(
        {
          ok: false,
          code: "stale_state",
          message:
            "The demo changed in another browser. Reloaded the latest state; add the food again if it is still correct.",
          profile: error.current,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, message: "The catalog food could not be added." },
      { status: 400 },
    );
  }
}
