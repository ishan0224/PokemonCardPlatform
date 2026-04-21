"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type AdminDropPublishButtonProps = {
  dropId: string;
};

export function AdminDropPublishButton({ dropId }: AdminDropPublishButtonProps): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPublish = async (): Promise<void> => {
    setPending(true);
    setError(null);

    try {
      await apiClient.publishAdminDrop(dropId);
      router.refresh();
    } catch (caughtError) {
      setError(mapApiErrorToMessage(caughtError) || "Failed to publish drop.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="primary" size="sm" loading={pending} onClick={() => void onPublish()}>
        {pending ? "Publishing..." : "Publish"}
      </Button>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
