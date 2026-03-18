"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token")?.trim() ?? "");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    if (!token) {
      setError("No se encontro token de recuperacion.");
      setSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      setSubmitting(false);
      return;
    }

    try {
      await apiRequest<{ success: true }>("/auth/reset-password", {
        method: "POST",
        body: {
          token,
          newPassword: password,
        },
      });
      setSuccessMessage("Contrasena actualizada correctamente.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo restablecer la contrasena";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="text-2xl">Restablecer contrasena</CardTitle>
          <p className="text-sm text-muted-foreground">
            Define una nueva clave para tu cuenta.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nueva contrasena</label>
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

            {successMessage ? (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <p>{successMessage}</p>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Actualizar contrasena"
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
