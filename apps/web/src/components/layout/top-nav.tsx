"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Heart, ShoppingCart, Store, UserCircle2 } from "lucide-react";
import { resolveTenantByKey } from "@/lib/api";
import type { Cart } from "@/lib/types";
import { CART_CHANGED_EVENT, type CartChangedPayload } from "@/lib/ui-events";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";

const STORAGE_LAST_TENANT_KEY = "ecommerce_last_tenant_key";

function extractTenantKey(pathname: string): string | null {
  const match = pathname.match(/^\/(?:tienda|carrito|admin)\/([^/?#]+)/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, authedRequest } = useAuth();
  const [cartItemsCount, setCartItemsCount] = useState(0);
  const [lastTenantKey, setLastTenantKey] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("Ecom Platform");
  const canAdmin =
    user?.role === "platform_superadmin" ||
    user?.role === "tenant_admin" ||
    user?.role === "catalog_manager" ||
    user?.role === "order_manager" ||
    user?.role === "support";

  useEffect(() => {
    const routeTenantKey = extractTenantKey(pathname);
    if (routeTenantKey) {
      setLastTenantKey(routeTenantKey);
      window.localStorage.setItem(STORAGE_LAST_TENANT_KEY, routeTenantKey);
      return;
    }

    if (lastTenantKey !== null) {
      return;
    }

    const storedTenantKey = window.localStorage.getItem(STORAGE_LAST_TENANT_KEY);
    if (storedTenantKey) {
      setLastTenantKey(storedTenantKey);
    }
  }, [lastTenantKey, pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadStoreName() {
      const tenantKey = extractTenantKey(pathname) ?? lastTenantKey ?? user?.tenantId ?? null;
      if (!tenantKey) {
        if (!cancelled) {
          setStoreName("Ecom Platform");
        }
        return;
      }

      try {
        const tenant = await resolveTenantByKey(tenantKey);
        if (!cancelled) {
          setStoreName(tenant.name);
        }
      } catch {
        if (!cancelled) {
          setStoreName("Ecom Platform");
        }
      }
    }

    void loadStoreName();
    return () => {
      cancelled = true;
    };
  }, [lastTenantKey, pathname, user?.tenantId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCartCount() {
      if (!user) {
        if (!cancelled) {
          setCartItemsCount(0);
        }
        return;
      }

      try {
        let tenantId = user.tenantId;
        if (!tenantId && lastTenantKey) {
          const tenant = await resolveTenantByKey(lastTenantKey);
          tenantId = tenant.id;
        }

        if (!tenantId) {
          if (!cancelled) {
            setCartItemsCount(0);
          }
          return;
        }

        const cart = await authedRequest<Cart>(`/cart/me?tenantId=${tenantId}`);
        if (cancelled) {
          return;
        }
        const count = cart.items.reduce((total, item) => total + item.quantity, 0);
        setCartItemsCount(count);
      } catch {
        if (!cancelled) {
          setCartItemsCount(0);
        }
      }
    }

    function onCartChanged(event: Event) {
      const customEvent = event as CustomEvent<CartChangedPayload>;
      const updatedCount = customEvent.detail?.itemsCount;
      if (typeof updatedCount === "number") {
        setCartItemsCount(updatedCount);
        return;
      }

      void loadCartCount();
    }

    void loadCartCount();
    window.addEventListener(CART_CHANGED_EVENT, onCartChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
    };
  }, [authedRequest, lastTenantKey, pathname, user]);

  async function handleLogout() {
    await logout();
    setCartItemsCount(0);
    router.push("/login");
  }

  const activeStoreKey = extractTenantKey(pathname) ?? lastTenantKey ?? user?.tenantId ?? "";
  const storeHomeHref = activeStoreKey ? `/tienda/${encodeURIComponent(activeStoreKey)}` : "/";
  const activeCartKey = extractTenantKey(pathname) ?? user?.tenantId ?? lastTenantKey ?? "";
  const cartHref = user ? (activeCartKey ? `/carrito/${encodeURIComponent(activeCartKey)}` : "/") : "/login";

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href={storeHomeHref} className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <Store className="h-5 w-5 text-primary" />
          <span>{storeName}</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/mis-pedidos">
            <Button variant="ghost" size="sm">
              Pedidos
            </Button>
          </Link>
          <Link href="/favoritos">
            <Button variant="ghost" size="sm">
              <Heart className="h-4 w-4" />
              Favoritos
            </Button>
          </Link>
          {canAdmin && user?.tenantId ? (
            <Link href="/panel">
              <Button variant="ghost" size="sm">
                Admin
              </Button>
            </Link>
          ) : null}
          <Link href={cartHref}>
            <Button variant="ghost" size="sm" className="relative">
              <ShoppingCart className="h-4 w-4" />
              Carrito
              {cartItemsCount > 0 ? (
                <span className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {cartItemsCount > 99 ? "99+" : cartItemsCount}
                </span>
              ) : null}
            </Button>
          </Link>

          {user ? (
            <>
              <Link href="/cuenta">
                <Button variant="outline" size="sm">
                  <UserCircle2 className="h-4 w-4" />
                  {user.fullName}
                </Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={handleLogout}>
                Salir
              </Button>
            </>
          ) : (
            <>
              <Link href="/registro">
                <Button variant="outline" size="sm">Crear cuenta</Button>
              </Link>
              <Link href="/login">
                <Button size="sm">Iniciar Sesion</Button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
