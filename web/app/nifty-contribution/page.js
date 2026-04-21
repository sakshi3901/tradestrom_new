import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import NiftyContributionDashboard from "@/components/niftyContribution/NiftyContributionDashboard";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export const metadata = {
  title: "NIFTY 50 Contribution Dashboard | Tradestrom"
};

export default async function NiftyContributionPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  let access;
  try {
    access = await checkAccess(session.user.email);
  } catch (error) {
    redirect("/");
  }

  if (!access?.allowed) {
    redirect("/");
  }

  return <NiftyContributionDashboard />;
}
