"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import { ApiError, resolveTenantById } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedError = (error ?? "").toLowerCase();
  const canResendVerification =
    normalizedError.includes("email is not verified") ||
    normalizedError.includes("correo no esta verificado") ||
    normalizedError.includes("cuenta administrativa no esta activada");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const session = await login(email, password);
      const nextUser = session.user;

      if (nextUser?.tenantId) {
        const tenant = await resolveTenantById(nextUser.tenantId);
        const isAdminRole =
          nextUser.role === "platform_superadmin" ||
          nextUser.role === "tenant_admin" ||
          nextUser.role === "catalog_manager" ||
          nextUser.role === "order_manager" ||
          nextUser.role === "support";

        router.push(isAdminRole ? `/admin/${tenant.slug}` : `/tienda/${tenant.slug}`);
      } else {
        router.push("/mis-pedidos");
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No fue posible iniciar sesion";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="text-2xl">Iniciar sesion</CardTitle>
          <p className="text-sm text-muted-foreground">
            Inicia sesion para comprar, gestionar tu carrito y revisar tus pedidos.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Correo</label>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="cliente@correo.com"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Contrasena</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="********"
                required
              />
              <div className="text-right">
                <Link href="/recuperar-contrasena" className="text-xs font-medium text-foreground underline">
                  Olvide mi contrasena
                </Link>
              </div>
              <div className="text-right">
                <Link href={`/reenviar-verificacion?email=${encodeURIComponent(email)}`} className="text-xs font-medium text-foreground underline">
                  Reenviar verificacion
                </Link>
              </div>
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div className="space-y-2">
                  <p>{error}</p>
                  {canResendVerification ? (
                    <Link
                      href={`/reenviar-verificacion?email=${encodeURIComponent(email)}`}
                      className="inline-block text-xs font-semibold underline"
                    >
                      Reenviar correo de verificacion
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ingresando...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Entrar
                </>
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            No tienes cuenta?{" "}
            <Link href="/registro" className="font-medium text-foreground underline">
              Registrate
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
