"use client";

import type { OrderReturn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export type ReturnActionStatus =
  | "approved"
  | "pickup_pending"
  | "pickup_assigned"
  | "picked_up"
  | "received"
  | "rejected"
  | "refunded";

export type ReturnActionModalState = {
  entry: OrderReturn;
  status: ReturnActionStatus;
};

type ReturnActionModalProps = {
  modal: ReturnActionModalState | null;
  submitting: boolean;
  error: string | null;
  adminNote: string;
  refundAmount: string;
  pickupCourierName: string;
  pickupCourierPhone: string;
  pickupScheduledAt: string;
  pickupCompletedAt: string;
  onAdminNoteChange: (value: string) => void;
  onRefundAmountChange: (value: string) => void;
  onPickupCourierNameChange: (value: string) => void;
  onPickupCourierPhoneChange: (value: string) => void;
  onPickupScheduledAtChange: (value: string) => void;
  onPickupCompletedAtChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function formatReturnStatus(status: OrderReturn["status"]) {
  if (status === "requested") return "solicitada";
  if (status === "approved") return "aprobada";
  if (status === "pickup_pending") return "recojo pendiente";
  if (status === "pickup_assigned") return "recojo asignado";
  if (status === "picked_up") return "recogido";
  if (status === "received") return "recibido en almacen";
  if (status === "rejected") return "rechazada";
  if (status === "refunded") return "reembolsada";
  return status;
}

function formatReturnActionLabel(status: ReturnActionStatus): string {
  if (status === "approved") return "Aprobar devolucion";
  if (status === "pickup_pending") return "Iniciar recojo";
  if (status === "pickup_assigned") return "Asignar recojo";
  if (status === "picked_up") return "Marcar recogido";
  if (status === "received") return "Confirmar recibido";
  if (status === "rejected") return "Rechazar devolucion";
  if (status === "refunded") return "Reembolsar";
  return "Actualizar devolucion";
}

export function ReturnActionModal({
  modal,
  submitting,
  error,
  adminNote,
  refundAmount,
  pickupCourierName,
  pickupCourierPhone,
  pickupScheduledAt,
  pickupCompletedAt,
  onAdminNoteChange,
  onRefundAmountChange,
  onPickupCourierNameChange,
  onPickupCourierPhoneChange,
  onPickupScheduledAtChange,
  onPickupCompletedAtChange,
  onClose,
  onSubmit,
}: ReturnActionModalProps) {
  return (
    <Modal open={Boolean(modal)} onClose={onClose} contentClassName="max-w-xl">
      {modal ? (
        <>
          <h2 className="text-lg font-semibold">{formatReturnActionLabel(modal.status)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Orden #{modal.entry.orderId.slice(0, 8)} | Estado actual: {formatReturnStatus(modal.entry.status)}
          </p>

          {error ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          ) : null}

          <div className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-foreground">Nota administrativa (opcional)</span>
              <textarea
                value={adminNote}
                onChange={(event) => onAdminNoteChange(event.target.value)}
                className="min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
                placeholder="Detalle interno para esta accion"
              />
            </label>

            {modal.status === "pickup_assigned" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Nombre repartidor</span>
                  <Input
                    value={pickupCourierName}
                    onChange={(event) => onPickupCourierNameChange(event.target.value)}
                    placeholder="Nombre del courier"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Telefono repartidor</span>
                  <Input
                    value={pickupCourierPhone}
                    onChange={(event) => onPickupCourierPhoneChange(event.target.value)}
                    placeholder="999999999"
                  />
                </label>
                <label className="block space-y-1 md:col-span-2">
                  <span className="text-xs font-medium text-foreground">Fecha/hora de recojo</span>
                  <Input
                    type="datetime-local"
                    value={pickupScheduledAt}
                    onChange={(event) => onPickupScheduledAtChange(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {modal.status === "picked_up" || (modal.status === "received" && !modal.entry.pickupCompletedAt) ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground">Fecha/hora de recojo completado</span>
                <Input
                  type="datetime-local"
                  value={pickupCompletedAt}
                  onChange={(event) => onPickupCompletedAtChange(event.target.value)}
                />
              </label>
            ) : null}

            {modal.status === "refunded" ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground">Monto a reembolsar (opcional)</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={refundAmount}
                  onChange={(event) => onRefundAmountChange(event.target.value)}
                  placeholder="Dejar vacio para monto pendiente total"
                />
              </label>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" disabled={submitting} onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={submitting} onClick={onSubmit}>
              {submitting ? "Guardando..." : "Confirmar"}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
