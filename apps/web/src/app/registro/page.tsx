"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, UserPlus } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { notify } from "@/lib/ui-events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-provider";

type RegisterCustomerResponse = {
  user: { id: string };
  emailVerificationRequired: boolean;
  emailDeliveryEnabled: boolean;
  verificationEmailSent: boolean;
};

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden");
      return;
    }

    setSubmitting(true);
    try {
      const registerResponse = await apiRequest<RegisterCustomerResponse>("/auth/register/customer", {
        method: "POST",
        body: {
          fullName,
          email,
          password,
        },
      });

      if (registerResponse.emailVerificationRequired) {
        if (registerResponse.verificationEmailSent) {
          notify({
            tone: "info",
            title: "Cuenta creada",
            description: "Te enviamos un correo para verificar tu cuenta. Revisa tu bandeja.",
          });
          router.push(`/verificar-email?email=${encodeURIComponent(email)}`);
          return;
        }

        notify({
          tone: "info",
          title: "Cuenta creada",
          description: "El servidor tiene desactivado el envio de correos. Activa SMTP para verificar por email.",
        });
        router.push(`/verificar-email?email=${encodeURIComponent(email)}&mail=disabled`);
        return;
      }

      await login(email, password);
      notify({
        tone: "success",
        title: "Cuenta creada",
        description: "Tu registro fue exitoso. Ya puedes comprar.",
      });
      router.push("/");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No fue posible completar el registro";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="text-2xl">Crear cuenta</CardTitle>
          <p className="text-sm text-muted-foreground">Registrate para comprar y ver tus pedidos.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nombre completo</label>
              <Input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Tu nombre"
                required
              />
            </div>
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
                placeholder="Minimo 8 caracteres"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Confirmar contrasena</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repite la contrasena"
                minLength={8}
                required
              />
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <p>{error}</p>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creando cuenta...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Registrarme
                </>
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Ya tienes cuenta?{" "}
            <Link href="/login" className="font-medium text-foreground underline">
              Inicia sesion
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
