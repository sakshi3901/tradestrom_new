"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast } from "react-hot-toast";

export default function LandingUnauthorizedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shouldShow = searchParams.get("unauthorized") === "1";

  useEffect(() => {
    if (!shouldShow) {
      return;
    }

    toast.error("No active plan. Unauthorized user", {
      id: "unauthorized-landing",
      duration: 4000,
      style: {
        zIndex: 10000000
      }
    });

    router.replace(pathname || "/", { scroll: false });
  }, [shouldShow, router, pathname]);

  return (
    <Toaster
      position="top-right"
      containerStyle={{ zIndex: 10000000 }}
      toastOptions={{
        style: {
          zIndex: 10000000
        }
      }}
    />
  );
}
