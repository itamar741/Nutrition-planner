import { notFound, redirect } from "next/navigation";
import { CoachWorkspace } from "@/components/coach-workspace/CoachWorkspace";
import type { DemoProfileId } from "@/domain/profile/types";
import { hasServerAccess } from "@/security/demo-access";

export const dynamic = "force-dynamic";

export default async function CoachPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  if (!(await hasServerAccess())) redirect("/?access=required");
  const { profileId } = await params;
  if (profileId !== "new" && profileId !== "existing") notFound();
  return <CoachWorkspace profileId={profileId as DemoProfileId} />;
}
