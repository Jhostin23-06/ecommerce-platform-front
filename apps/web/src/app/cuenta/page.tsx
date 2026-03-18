"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, UserCircle2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import { notify } from "@/lib/ui-events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function AccountPage() {
  const router = useRouter();
  const { authedRequest, loading: authLoading, setUserSession, user } = useAuth();

  const [profile, setProfile] = useState<User | null>(user);
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      if (!user) {
        setLoading(false);
        router.replace("/login");
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const profileResponse = await authedRequest<User>("/users/me");
        if (cancelled) {
          return;
        }
        setProfile(profileResponse);
        setFullName(profileResponse.fullName);
        setUserSession(profileResponse);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "No se pudo cargar tu cuenta";
        if (!cancelled) {
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [authLoading, authedRequest, router, setUserSession, user?.id]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setError(null);
    try {
      const updatedUser = await authedRequest<User>("/users/me/profile", {
        method: "PATCH",
        body: { fullName },
      });
      setProfile(updatedUser);
      setUserSession(updatedUser);
      notify({
        tone: "success",
        title: "Cuenta actualizada",
        description: "Tu perfil se guardo correctamente.",
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar tu perfil";
      setError(message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("La nueva contraseña y la confirmación no coinciden.");
      return;
    }

    setSavingPassword(true);
    setError(null);
    try {
      await authedRequest<{ success: true }>("/users/me/password", {
        method: "PATCH",
        body: {
          currentPassword,
          newPassword,
        },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify({
        tone: "success",
        title: "Contraseña actualizada",
        description: "Tu contraseña ya fue cambiada.",
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar la contraseña";
      setError(message);
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border/80 bg-card/80 p-6">
        <h1 className="text-3xl font-bold">Mi cuenta</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Administra tus datos de acceso y tu perfil principal.
        </p>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <UserCircle2 className="h-4 w-4" />
              Perfil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={saveProfile}>
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nombre completo" />
              <Input value={profile?.email ?? ""} disabled placeholder="Email" />
              <Input value={profile?.role ?? ""} disabled placeholder="Rol" />
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Guardar perfil
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <LockKeyhole className="h-4 w-4" />
              Seguridad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={savePassword}>
              <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Contraseña actual" />
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nueva contraseña" />
              <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirmar nueva contraseña" />
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Cambiar contraseña
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
