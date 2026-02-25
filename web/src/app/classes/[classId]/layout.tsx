import type { ReactNode } from "react";
import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";

export default async function ClassRouteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { accountType, user, profile } = await requireVerifiedUser();

  return (
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType={accountType}
        userEmail={user.email ?? undefined}
        userDisplayName={profile.display_name}
        classId={classId}
      />
      <div className="sidebar-content">{children}</div>
    </div>
  );
}
