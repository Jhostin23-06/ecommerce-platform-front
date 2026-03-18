"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  contentClassName?: string;
};

export function Modal({ open, onClose, children, contentClassName }: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div className={cn("w-full rounded-2xl border border-border bg-card p-5 shadow-2xl", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
