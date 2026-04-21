import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import TopRightSignOutClient from "@/components/TopRightSignOutClient";

export default async function TopRightSignOut() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return null;
  }

  return <TopRightSignOutClient />;
}
