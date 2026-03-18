import Link from "next/link";
import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CheckoutCancelPage() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <section className="fade-up rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <CircleX className="mx-auto mb-4 h-12 w-12 text-amber-600" />
        <h1 className="text-2xl font-bold text-amber-900">Pago cancelado</h1>
        <p className="mt-2 text-sm text-amber-800">
          Puedes volver a tu carrito y finalizar la compra cuando quieras.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/">
            <Button>Volver al inicio</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
