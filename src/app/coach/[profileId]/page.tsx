import { notFound } from "next/navigation";
import { CoachWorkspace } from "@/components/coach-workspace/CoachWorkspace";
import type { DemoProfileId } from "@/domain/profile/types";

export default async function CoachPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  if (profileId !== "new" && profileId !== "existing") notFound();
  return <CoachWorkspace profileId={profileId as DemoProfileId} />;
}
