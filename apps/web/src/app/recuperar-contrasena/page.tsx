"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function RecoverPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await apiRequest<{ success: true; message: string }>("/auth/request-password-reset", {
        method: "POST",
        body: { email },
      });
      setSuccessMessage(response.message);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo procesar la solicitud";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="text-2xl">Recuperar contrasena</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingresa tu correo y te enviaremos un enlace para restablecer la clave.
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

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <p>{error}</p>
              </div>
            ) : null}

            {successMessage ? (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <MailCheck className="mt-0.5 h-4 w-4" />
                <p>{successMessage}</p>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                "Enviar enlace"
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground underline">
              Volver a login
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
