"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { APP_NOTIFY_EVENT, type NotifyPayload } from "@/lib/ui-events";

type NotificationState = NotifyPayload & { id: number };

export function NotificationHost() {
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleNotify(event: Event) {
      const customEvent = event as CustomEvent<NotifyPayload>;
      const payload = customEvent.detail;
      if (!payload?.title) {
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setNotification({
        id: Date.now(),
        title: payload.title,
        description: payload.description,
        tone: payload.tone ?? "info",
      });

      timeoutRef.current = setTimeout(() => {
        setNotification(null);
      }, 2600);
    }

    window.addEventListener(APP_NOTIFY_EVENT, handleNotify);
    return () => {
      window.removeEventListener(APP_NOTIFY_EVENT, handleNotify);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!notification) {
    return null;
  }

  const icon =
    notification.tone === "success" ? (
      <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
    ) : notification.tone === "error" ? (
      <AlertCircle className="mt-0.5 h-5 w-5 text-rose-600" />
    ) : (
      <Info className="mt-0.5 h-5 w-5 text-sky-600" />
    );

  const toneClass =
    notification.tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : notification.tone === "error"
        ? "border-rose-200 bg-rose-50"
        : "border-sky-200 bg-sky-50";

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[60] w-[calc(100%-2rem)] max-w-sm sm:right-6">
      <div className={`rounded-2xl border p-4 shadow-lg ${toneClass}`}>
        <div className="flex items-start gap-3">
          {icon}
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{notification.title}</p>
            {notification.description ? (
              <p className="text-xs text-muted-foreground">{notification.description}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
