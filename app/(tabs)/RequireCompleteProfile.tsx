import { useAuth } from "@/app/providers/AuthProvider";
import { getMyProfile } from "@/utils/api";
import { getCachedProfileStatus, isProfileComplete } from "@/utils/profileCache";
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";

const hasMinPhone = (p: any) => String(p?.phoneNumber || "").replace(/\D/g, "").length >= 10;

export default function RequireCompleteProfile({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [status, setStatus] = useState<"waiting-auth" | "checking" | "ok" | "incomplete">("waiting-auth");

  useEffect(() => {
    let alive = true;
    if (!session) {
      return;
    }
    setStatus("checking");
    (async () => {
      try {
        // First check cache for instant response
        const cached = await getCachedProfileStatus();
        if (cached) {
          // Use cache if available and valid
          if (alive) {
            setStatus(cached.isComplete ? "ok" : "incomplete");
          }
          
          // Verify in background (non-blocking)
          (async () => {
            try {
              const p = await getMyProfile();
              const complete = p?.firstName && p?.dob && hasMinPhone(p);
              if (alive && complete !== cached.isComplete) {
                // Only update if status changed
                setStatus(complete ? "ok" : "incomplete");
              }
            } catch {
              // Silent failure - cache result stands
            }
          })();
          return;
        }
        
        // No cache - make API call
        const p = await getMyProfile();
        if (p?.firstName && p?.dob && hasMinPhone(p)) {
          if (alive) setStatus("ok");
        } else {
          if (alive) setStatus("incomplete");
        }
      } catch {
        if (alive) setStatus("incomplete");
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  if (status === "incomplete") {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  return <>{children}</>;
}

