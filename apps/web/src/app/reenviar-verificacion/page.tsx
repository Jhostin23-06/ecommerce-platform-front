"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { notify } from "@/lib/ui-events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ResendVerificationResponse = {
  success: true;
  message: string;
  emailDeliveryEnabled: boolean;
  verificationEmailSent: boolean;
};

export default function ResendVerificationPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const initialEmail = new URLSearchParams(window.location.search).get("email");
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await apiRequest<ResendVerificationResponse>("/auth/verification/resend-by-email", {
        method: "POST",
        body: { email },
      });

      setMessage(response.message);
      if (response.verificationEmailSent) {
        notify({
          tone: "success",
          title: "Correo reenviado",
          description: "Revisa tu bandeja y tu carpeta de spam.",
        });
        return;
      }

      if (!response.emailDeliveryEnabled) {
        notify({
          tone: "info",
          title: "SMTP desactivado",
          description: "El servidor no puede enviar correos hasta activar MAIL_ENABLED y SMTP.",
        });
      }
    } catch (err) {
      const apiMessage = err instanceof ApiError ? err.message : "No fue posible reenviar el correo";
      setError(apiMessage);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="text-2xl">Reenviar verificacion / activacion</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingresa tu correo para generar un nuevo enlace de verificacion o activacion de cuenta.
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

            {message ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700">
                {message}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <MailCheck className="h-4 w-4" />
                  Reenviar correo
                </>
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
