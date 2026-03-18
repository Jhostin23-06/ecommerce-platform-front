"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/utils";
import type { Order, OrderReturn } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function parseApiErrorMessage(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message) && parsed.message.length) {
      const first = parsed.message.find((entry) => typeof entry === "string");
      if (first) {
        return first;
      }
    }
    return fallback;
  } catch {
    return text.trim() || fallback;
  }
}

function formatOrderStatus(status: Order["lifecycleStatus"]) {
  if (status === "delivered") {
    return "entregado";
  }
  if (status === "shipped") {
    return "enviado";
  }
  if (status === "preparing") {
    return "preparando";
  }
  if (status === "paid") {
    return "pagado";
  }
  if (status === "pending") {
    return "pendiente";
  }
  if (status === "cancelled") {
    return "cancelado";
  }
  return status;
}

function lifecycleTone(status: Order["lifecycleStatus"]): "success" | "warning" | "neutral" {
  if (status === "delivered") {
    return "success";
  }
  if (status === "cancelled") {
    return "warning";
  }
  return "neutral";
}

function formatPaymentStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "paid") {
    return "pagado";
  }
  if (normalized === "partially_refunded") {
    return "reembolso parcial";
  }
  if (normalized === "refunded") {
    return "reembolsado";
  }
  if (normalized === "unpaid") {
    return "no pagado";
  }
  if (normalized === "pending") {
    return "pendiente";
  }
  if (normalized === "failed") {
    return "fallido";
  }
  return status;
}

function formatFulfillmentType(type: Order["fulfillmentType"]) {
  return type === "delivery" ? "delivery" : "recojo";
}

function formatFulfillmentStatus(status: Order["fulfillmentStatus"]) {
  if (status === "pending") return "pendiente";
  if (status === "preparing") return "preparando";
  if (status === "ready_for_dispatch") return "listo para despacho";
  if (status === "on_the_way") return "en ruta";
  if (status === "ready_for_pickup") return "listo para recojo";
  if (status === "completed") return "completado";
  if (status === "failed") return "fallido";
  return status;
}

function formatReturnStatus(status: OrderReturn["status"]) {
  if (status === "requested") return "devolución solicitada";
  if (status === "approved") return "devolución aprobada";
  if (status === "pickup_pending") return "recojo pendiente";
  if (status === "pickup_assigned") return "recojo asignado";
  if (status === "picked_up") return "producto recogido";
  if (status === "received") return "producto recibido en almacén";
  if (status === "rejected") return "devolución rechazada";
  if (status === "refunded") return "devolución reembolsada";
  return status;
}

function formatHistoryEntry(entry: Order["statusHistory"][number]) {
  if (entry.source === "returns") {
    return entry.note ?? "actualización de devolución";
  }
  return formatOrderStatus(entry.nextStatus);
}

export default function MyOrdersPage() {
  const router = useRouter();
  const { user, accessToken, authedRequest, loading: authLoading } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderReturns, setOrderReturns] = useState<OrderReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returnModalOrder, setReturnModalOrder] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnAmountInput, setReturnAmountInput] = useState("");
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [pdfOrderIdLoading, setPdfOrderIdLoading] = useState<string | null>(null);

  const returnByOrderId = useMemo(() => {
    const map = new Map<string, OrderReturn>();
    for (const entry of orderReturns) {
      const existing = map.get(entry.orderId);
      if (!existing || new Date(entry.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        map.set(entry.orderId, entry);
      }
    }
    return map;
  }, [orderReturns]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      router.push("/login");
      return;
    }

    async function loadOrders() {
      setLoading(true);
      setError(null);
      try {
        const [data, returnsData] = await Promise.all([
          authedRequest<Order[]>("/orders/me"),
          authedRequest<OrderReturn[]>("/returns/me"),
        ]);
        setOrders(data);
        setOrderReturns(returnsData);

        const pendingOrders = data.filter(
          (order) => order.status === "pending_payment" && order.paymentStatus !== "paid",
        );

        if (pendingOrders.length) {
          const syncResults = await Promise.allSettled(
            pendingOrders.map((order) =>
              authedRequest(`/payments/order/${order.id}/reconcile`, {
                method: "POST",
              }),
            ),
          );

          const hasAnySynced = syncResults.some((result) => result.status === "fulfilled");
          if (hasAnySynced) {
            const refreshedOrders = await authedRequest<Order[]>("/orders/me");
            setOrders(refreshedOrders);
          }
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "No se pudieron cargar tus pedidos";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    void loadOrders();
  }, [authLoading, authedRequest, router, user]);

  function openReturnModal(order: Order) {
    setReturnModalOrder(order);
    setReturnReason("");
    setReturnAmountInput("");
  }

  function closeReturnModal() {
    if (submittingReturn) {
      return;
    }
    setReturnModalOrder(null);
    setReturnReason("");
    setReturnAmountInput("");
  }

  async function requestReturnFromModal() {
    if (!returnModalOrder) {
      return;
    }
    const reason = returnReason.trim();
    if (!reason) {
      setError("Debes indicar el motivo de devolución.");
      return;
    }

    const amountInput = returnAmountInput.trim();
    const requestedAmount = amountInput.length ? Number(amountInput) : undefined;

    if (requestedAmount !== undefined && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
      setError("Monto inválido para la devolución.");
      return;
    }

    try {
      setSubmittingReturn(true);
      await authedRequest("/returns", {
        method: "POST",
        body: {
          orderId: returnModalOrder.id,
          reason,
          requestedAmount,
        },
      });

      const [ordersData, returnsData] = await Promise.all([
        authedRequest<Order[]>("/orders/me"),
        authedRequest<OrderReturn[]>("/returns/me"),
      ]);
      setOrders(ordersData);
      setOrderReturns(returnsData);
      setReturnModalOrder(null);
      setReturnReason("");
      setReturnAmountInput("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo solicitar devolución";
      setError(message);
    } finally {
      setSubmittingReturn(false);
    }
  }

  async function openOrderDocumentPdf(order: Order) {
    if (!accessToken) {
      setError("Tu sesion expiro. Inicia sesion nuevamente.");
      return;
    }

    setPdfOrderIdLoading(order.id);
    setError(null);

    try {
      const link = await authedRequest<{ documentNumber: string; pdfUrl: string | null }>(
        `/billing/orders/${order.id}/documents/latest/link`,
      );
      if (link.pdfUrl) {
        window.open(link.pdfUrl, "_blank", "noopener,noreferrer");
        return;
      }

      const response = await fetch(`${API_URL}/billing/orders/${order.id}/documents/latest/pdf`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(parseApiErrorMessage(errorText, "No se pudo abrir el PDF del comprobante"));
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo abrir el comprobante";
      setError(message);
    } finally {
      setPdfOrderIdLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="fade-up rounded-2xl border border-border bg-card/70 p-5">
        <h1 className="text-2xl font-bold">Mis pedidos</h1>
        <p className="text-sm text-muted-foreground">Historial de compras y estado de pago.</p>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Card key={order.id}>
              {(() => {
                const orderReturn = returnByOrderId.get(order.id);
                const canRequestReturn =
                  !orderReturn &&
                  order.status === "paid" &&
                  order.fulfillmentStatus === "completed" &&
                  (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded");

                return (
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Orden #{order.id.slice(0, 8)}</CardTitle>
                <div className="flex gap-2">
                  <Badge tone={lifecycleTone(order.lifecycleStatus)}>
                    {formatOrderStatus(order.lifecycleStatus)}
                  </Badge>
                  <Badge tone={order.paymentStatus === "paid" ? "success" : "neutral"}>
                    {formatPaymentStatus(order.paymentStatus)}
                  </Badge>
                  <Badge tone={order.fulfillmentStatus === "completed" ? "success" : "neutral"}>
                    {formatFulfillmentStatus(order.fulfillmentStatus)}
                  </Badge>
                  {orderReturn ? (
                    <Badge tone={orderReturn.status === "rejected" ? "warning" : "neutral"}>
                      {formatReturnStatus(orderReturn.status)}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
                );
              })()}
              <CardContent className="space-y-2 text-sm">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between border-b border-border/70 pb-1">
                    <span>
                      {item.productName} x {item.quantity}
                    </span>
                    <span>{formatMoney(item.lineTotal, order.currency)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(order.total, order.currency)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Metodo: {formatFulfillmentType(order.fulfillmentType)} | Envio: {formatMoney(order.shippingFee, order.currency)}
                </div>
                {order.fulfillmentType === "delivery" && order.deliveryAddress ? (
                  <div className="text-xs text-muted-foreground">
                    Direccion: {order.deliveryAddress.line1}, {order.deliveryAddress.district}, {order.deliveryAddress.city}
                  </div>
                ) : null}
                {order.fulfillmentType === "delivery" ? (
                  <div className="text-xs text-muted-foreground">
                    Zona: {order.deliveryZoneName ?? "No definida"} | Ventana: {order.deliveryWindow ?? "Sin ventana"}
                  </div>
                ) : null}
                {order.fulfillmentType === "pickup" && order.pickupDetails ? (
                  <div className="text-xs text-muted-foreground">
                    Recojo: {order.pickupDetails.pointName} | {order.pickupDetails.windowLabel}
                  </div>
                ) : null}
                {order.assignedCourierName || order.assignedCourierPhone ? (
                  <div className="text-xs text-muted-foreground">
                    Repartidor: {order.assignedCourierName ?? "-"} {order.assignedCourierPhone ? `(${order.assignedCourierPhone})` : ""}
                  </div>
                ) : null}
                {order.estimatedFulfillmentAt ? (
                  <div className="text-xs text-muted-foreground">
                    Estimado: {formatDateTime(order.estimatedFulfillmentAt)}
                  </div>
                ) : null}
                {order.billingDocumentStatus === "issued" && order.billingDocumentNumber ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">Comprobante: {order.billingDocumentNumber}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pdfOrderIdLoading === order.id}
                      onClick={() => void openOrderDocumentPdf(order)}
                    >
                      {pdfOrderIdLoading === order.id ? "Abriendo PDF..." : "Ver comprobante PDF"}
                    </Button>
                  </div>
                ) : null}
                {order.billingDocumentStatus && order.billingDocumentStatus !== "issued" ? (
                  <div className="text-xs text-amber-700">
                    Facturacion: {order.billingDocumentMessage ?? "Comprobante pendiente o sin configurar"}
                  </div>
                ) : null}
                {order.statusHistory.length ? (
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs text-muted-foreground">
                    <p className="mb-1 font-medium text-foreground">Historial</p>
                    {order.statusHistory.slice(-3).map((entry) => (
                      <p key={entry.id}>
                        {formatDateTime(entry.createdAt)} - {formatHistoryEntry(entry)}
                      </p>
                    ))}
                  </div>
                ) : null}
                {(() => {
                  const orderReturn = returnByOrderId.get(order.id);
                  const canRequestReturn =
                    !orderReturn &&
                    order.status === "paid" &&
                    order.fulfillmentStatus === "completed" &&
                    (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded");

                  if (orderReturn) {
                    return (
                      <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs text-muted-foreground">
                        Devolución: {formatReturnStatus(orderReturn.status)}
                        {orderReturn.adminNote ? ` | Nota admin: ${orderReturn.adminNote}` : ""}
                        {orderReturn.pickupCourierName || orderReturn.pickupCourierPhone
                          ? ` | Courier: ${orderReturn.pickupCourierName ?? "-"} ${orderReturn.pickupCourierPhone ? `(${orderReturn.pickupCourierPhone})` : ""}`
                          : ""}
                        {orderReturn.pickupScheduledAt ? ` | Recojo programado: ${formatDateTime(orderReturn.pickupScheduledAt)}` : ""}
                        {orderReturn.pickupCompletedAt ? ` | Recogido: ${formatDateTime(orderReturn.pickupCompletedAt)}` : ""}
                      </div>
                    );
                  }

                  if (!canRequestReturn) {
                    return null;
                  }

                  return (
                    <Button variant="outline" size="sm" onClick={() => openReturnModal(order)}>
                      Solicitar devolución
                    </Button>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
          {!orders.length ? (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                Aun no tienes pedidos registrados.
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {returnModalOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Solicitar devolución</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pedido #{returnModalOrder.id.slice(0, 8)}. Completa los datos para enviar la solicitud.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground">Motivo</span>
                <textarea
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  className="min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
                  placeholder="Describe por qué deseas devolver el producto"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground">Monto a devolver (opcional)</span>
                <Input
                  value={returnAmountInput}
                  onChange={(event) => setReturnAmountInput(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ejemplo: 25.50"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closeReturnModal} disabled={submittingReturn}>
                Cancelar
              </Button>
              <Button onClick={() => void requestReturnFromModal()} disabled={submittingReturn}>
                {submittingReturn ? "Enviando..." : "Enviar solicitud"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
