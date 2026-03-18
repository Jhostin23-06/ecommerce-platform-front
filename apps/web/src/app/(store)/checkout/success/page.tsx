"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cartChanged } from "@/lib/ui-events";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";

type ConfirmationResponse = {
  orderId: string;
  orderStatus: string;
  paymentStatus: string;
  checkoutSessionId: string;
  checkoutSessionStatus: string | null;
};

export default function CheckoutSuccessPage() {
  const { authedRequest } = useAuth();

  const [confirming, setConfirming] = useState(true);
  const [message, setMessage] = useState("Confirmando pago con Stripe...");
  const [isPaid, setIsPaid] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    const sessionIdParam = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionIdParam) {
      setConfirming(false);
      setMessage("No se encontro session_id. Verifica el estado en Mis pedidos.");
      return;
    }
    const sessionId = sessionIdParam;

    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    async function confirmSession() {
      setConfirming(true);
      try {
        const result = await authedRequest<ConfirmationResponse>(
          `/payments/checkout-session/${encodeURIComponent(sessionId)}/confirm`,
        );

        if (result.paymentStatus === "paid") {
          setIsPaid(true);
          setMessage("Pago confirmado. Tu pedido ya figura como pagado.");
        } else {
          setIsPaid(false);
          setMessage(
            "Stripe aun no confirma el pago. Revisa Mis pedidos en unos segundos o valida el webhook.",
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof ApiError
            ? error.message
            : "No se pudo confirmar el pago automaticamente. Revisa Mis pedidos.";
        setIsPaid(false);
        setMessage(errorMessage);
      } finally {
        cartChanged({ itemsCount: 0 });
        setConfirming(false);
      }
    }

    void confirmSession();
  }, [authedRequest]);

  return (
    <div className="mx-auto max-w-2xl py-12">
      <section className="fade-up rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" />
        <h1 className="text-2xl font-bold text-emerald-900">Pago procesado</h1>
        <p className="mt-2 text-sm text-emerald-800">{message}</p>

        {confirming ? (
          <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/60 px-4 py-2 text-sm text-emerald-900">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando estado...
          </div>
        ) : null}

        <div className="mt-6 flex justify-center gap-3">
          <Link href="/mis-pedidos">
            <Button>{isPaid ? "Ver pedido pagado" : "Ver mis pedidos"}</Button>
          </Link>
          <Link href="/">
            <Button variant="outline">Volver al inicio</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
