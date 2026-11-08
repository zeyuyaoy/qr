import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

/** Server-side gate for every private page. Client guards are only a convenience. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.isOwner) redirect("/login");
  return <AppShell email={session.user.email}>{children}</AppShell>;
}
