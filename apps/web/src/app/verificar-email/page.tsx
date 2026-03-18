"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type VerifyStatus = "loading" | "success" | "pending" | "error";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<VerifyStatus>("loading");
  const [message, setMessage] = useState("Validando token de verificacion...");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const email = params.get("email");
    const mailDisabled = params.get("mail") === "disabled";

    if (!token) {
      if (mailDisabled) {
        setStatus("error");
        setMessage(
          "Tu cuenta fue creada, pero el envio de correos esta desactivado en el servidor. Activa MAIL_ENABLED=true y SMTP para recibir el enlace de verificacion.",
        );
        return;
      }

      if (email) {
        setStatus("pending");
        setMessage(`Te enviamos un enlace de verificacion a ${email}. Abre el correo y haz click en ese enlace.`);
        return;
      }

      setStatus("error");
      setMessage("No se encontro token de verificacion.");
      return;
    }

    async function verify() {
      try {
        await apiRequest<{ success: true }>("/auth/verify-email", {
          method: "POST",
          body: { token },
        });
        setStatus("success");
        setMessage("Correo verificado correctamente.");
      } catch (error) {
        const errorMessage =
          error instanceof ApiError ? error.message : "No se pudo verificar el correo.";
        setStatus("error");
        setMessage(errorMessage);
      }
    }

    void verify();
  }, []);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="text-2xl">Verificacion de correo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`rounded-xl border p-4 text-sm ${
              status === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : status === "pending"
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <div className="mb-2 inline-flex items-center gap-2 font-semibold">
              {status === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando
                </>
              ) : status === "success" ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Verificado
                </>
              ) : status === "pending" ? (
                <>
                  <Loader2 className="h-4 w-4" />
                  Pendiente
                </>
              ) : (
                <>
                  <TriangleAlert className="h-4 w-4" />
                  No verificado
                </>
              )}
            </div>
            <p>{message}</p>
          </div>

          <div className="flex gap-2">
            <Link href="/login">
              <Button>Ir a login</Button>
            </Link>
            <Link href="/">
              <Button variant="outline">Volver al inicio</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
