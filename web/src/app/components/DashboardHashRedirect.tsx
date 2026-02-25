"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type DashboardHashRedirectProps = {
  classesHref: string;
};

export default function DashboardHashRedirect({ classesHref }: DashboardHashRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    if (window.location.hash !== "#classes") {
      return;
    }
    router.replace(classesHref);
  }, [classesHref, router]);

  return null;
}
