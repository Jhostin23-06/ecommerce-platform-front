"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shield, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-provider";

const ADMIN_ROLES = new Set(["platform_superadmin", "tenant_admin", "catalog_manager", "order_manager", "support"]);

export default function AdminPanelEntryPage() {
  const router = useRouter();
  const { loading, user, resolveCurrentTenant } = useAuth();

  const [tenantKey, setTenantKey] = useState("");
  const [resolvingTenant, setResolvingTenant] = useState(true);

  const canAccessAdmin = useMemo(() => {
    if (!user) {
      return false;
    }
    return ADMIN_ROLES.has(user.role);
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    let cancelled = false;

    async function resolveDefaultTenant() {
      if (!user?.tenantId) {
        setResolvingTenant(false);
        return;
      }

      try {
        const tenant = await resolveCurrentTenant();
        if (!cancelled) {
          setTenantKey(tenant?.slug ?? user.tenantId);
        }
      } finally {
        if (!cancelled) {
          setResolvingTenant(false);
        }
      }
    }

    void resolveDefaultTenant();

    return () => {
      cancelled = true;
    };
  }, [resolveCurrentTenant, user?.tenantId]);

  function handleOpenPanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantKey.trim()) {
      return;
    }
    router.push(`/admin/${encodeURIComponent(tenantKey.trim())}`);
  }

  if (loading || resolvingTenant) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!canAccessAdmin) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        <div className="mb-2 inline-flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" />
          Acceso restringido
        </div>
        Tu rol no tiene permisos de administrador.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-2xl">
            <Shield className="h-6 w-6" />
            Panel de administracion
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingresa el slug del tenant para abrir el panel de catalogo, ordenes, cupones y usuarios.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleOpenPanel} className="space-y-3">
            <Input
              value={tenantKey}
              onChange={(event) => setTenantKey(event.target.value)}
              placeholder="slug del tenant (ej: acme-demo)"
              required
            />
            <Button type="submit" className="w-full">
              Abrir panel
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Volver a la app cliente
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
