"use client";

import type { Order } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export type RefundOrderModalState = {
  order: Order;
  mode: "full" | "partial";
};

type OrderRefundModalProps = {
  modal: RefundOrderModalState | null;
  submitting: boolean;
  error: string | null;
  refundReason: string;
  refundAmount: string;
  onRefundReasonChange: (value: string) => void;
  onRefundAmountChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function OrderRefundModal({
  modal,
  submitting,
  error,
  refundReason,
  refundAmount,
  onRefundReasonChange,
  onRefundAmountChange,
  onClose,
  onSubmit,
}: OrderRefundModalProps) {
  return (
    <Modal open={Boolean(modal)} onClose={onClose} contentClassName="max-w-lg">
      {modal ? (
        <>
          <h2 className="text-lg font-semibold">
            {modal.mode === "partial" ? "Reembolso parcial" : "Reembolso total"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Orden #{modal.order.id.slice(0, 8)} | Total: {formatMoney(modal.order.total, modal.order.currency)}
          </p>

          {error ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-foreground">Motivo del reembolso</span>
              <textarea
                value={refundReason}
                onChange={(event) => onRefundReasonChange(event.target.value)}
                className="min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
                placeholder="Motivo visible en trazabilidad interna"
              />
            </label>

            {modal.mode === "partial" ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground">Monto a reembolsar</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={refundAmount}
                  onChange={(event) => onRefundAmountChange(event.target.value)}
                  placeholder="Ejemplo: 10.50"
                />
              </label>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" disabled={submitting} onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={submitting} onClick={onSubmit}>
              {submitting ? "Procesando..." : "Confirmar reembolso"}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
