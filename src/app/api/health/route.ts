import { NextResponse } from "next/server";
import { ensurePersistenceInitialized } from "@/persistence/migrations";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensurePersistenceInitialized();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Persistence is unavailable." },
      { status: 503 },
    );
  }
}
