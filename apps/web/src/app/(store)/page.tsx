"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Store } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import type { Tenant } from "@/lib/types";
import { Button } from "@/components/ui/button";

const DEFAULT_TENANT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG?.trim().toLowerCase() ?? "";

export default function HomePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveStorefront() {
      try {
        const tenants = await apiRequest<Tenant[]>("/tenants");
        const activeTenants = tenants.filter((tenant) => tenant.isActive);

        if (!activeTenants.length) {
          if (!cancelled) {
            setError("No hay tiendas activas disponibles en este momento.");
          }
          return;
        }

        const preferredTenant =
          activeTenants.find((tenant) => tenant.slug.toLowerCase() === DEFAULT_TENANT_SLUG) ?? activeTenants[0];

        if (!cancelled) {
          router.replace(`/tienda/${preferredTenant.slug}`);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "No se pudo abrir la tienda.";
        if (!cancelled) {
          setError(message);
        }
      }
    }

    void resolveStorefront();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700">
          <div className="mb-3 inline-flex items-center gap-2 font-semibold">
            <Store className="h-4 w-4" />
            Tienda no disponible
          </div>
          <p className="text-sm">{error}</p>
          <div className="mt-4">
            <Button onClick={() => window.location.reload()}>Reintentar</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando tienda...
      </div>
    </div>
  );
}
