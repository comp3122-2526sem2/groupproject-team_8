"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const POST_LOGIN_CLEANUP_PARAM = "post_login_cleanup";

type PostLoginRecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type TriggerPostLoginMaterialRecoveryOptions = {
  pathname: string;
  searchParams: URLSearchParams;
  replace: (href: string) => void;
  sendRecoveryRequest: () => Promise<void>;
  storage: PostLoginRecoveryStorage | null;
  onError?: (error: unknown) => void;
};

export async function triggerPostLoginMaterialRecovery(
  options: TriggerPostLoginMaterialRecoveryOptions,
) {
  const cleanupToken = options.searchParams.get(POST_LOGIN_CLEANUP_PARAM);
  if (!cleanupToken) {
    return;
  }

  const storageKey = `post-login-material-recovery:${cleanupToken}`;
  const existingState = options.storage?.getItem(storageKey);
  if (existingState === "pending" || existingState === "done") {
    return;
  }

  options.storage?.setItem(storageKey, "pending");

  try {
    await options.sendRecoveryRequest();
    options.storage?.setItem(storageKey, "done");

    const nextParams = new URLSearchParams(options.searchParams.toString());
    nextParams.delete(POST_LOGIN_CLEANUP_PARAM);
    const query = nextParams.toString();
    options.replace(query.length > 0 ? `${options.pathname}?${query}` : options.pathname);
  } catch (error) {
    options.storage?.removeItem(storageKey);
    options.onError?.(error);
  }
}

export default function PostLoginMaterialRecovery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsSnapshot = searchParams.toString();

  useEffect(() => {
    void triggerPostLoginMaterialRecovery({
      pathname,
      searchParams: new URLSearchParams(searchParamsSnapshot),
      replace: (href) => router.replace(href, { scroll: false }),
      sendRecoveryRequest: async () => {
        const response = await fetch("/api/materials/recover-stuck", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true,
        });

        if (!response.ok) {
          throw new Error(`Material recovery request failed with status ${response.status}.`);
        }
      },
      storage: typeof window === "undefined" ? null : window.sessionStorage,
      onError: (error) => {
        console.error("Failed to trigger post-login material recovery", error);
      },
    });
  }, [pathname, router, searchParamsSnapshot]);

  return null;
}
