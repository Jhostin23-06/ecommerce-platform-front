"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Heart, Loader2, ShoppingCart, Star } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cartChanged, notify } from "@/lib/ui-events";
import { formatMoney } from "@/lib/utils";
import type { Product, WishlistResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function productHref(product: Product) {
  return `/tienda/${encodeURIComponent(product.tenantId)}/producto/${encodeURIComponent(product.slug)}`;
}

export default function FavoritesPage() {
  const router = useRouter();
  const { authedRequest, user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadWishlist() {
    if (!user) {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const wishlist = await authedRequest<WishlistResponse>("/wishlist");
      setProducts(wishlist.items);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar favoritos";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWishlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function removeFromWishlist(product: Product) {
    setBusyProductId(product.id);
    try {
      await authedRequest(`/wishlist/items/${product.id}`, {
        method: "DELETE",
        body: { tenantId: product.tenantId },
      });
      setProducts((previous) => previous.filter((entry) => entry.id !== product.id));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo quitar de favoritos";
      notify({
        tone: "error",
        title: "Favoritos",
        description: message,
      });
    } finally {
      setBusyProductId(null);
    }
  }

  async function addToCart(product: Product) {
    setBusyProductId(product.id);
    try {
      const updatedCart = await authedRequest<{ items: Array<{ quantity: number }> }>("/cart/items", {
        method: "POST",
        body: {
          tenantId: product.tenantId,
          productId: product.id,
          quantity: 1,
        },
      });
      const itemsCount = updatedCart.items.reduce((total, item) => total + item.quantity, 0);
      cartChanged({ itemsCount });
      notify({
        tone: "success",
        title: "Producto agregado",
        description: `${product.name} se agrego al carrito.`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo agregar al carrito";
      notify({
        tone: "error",
        title: "Carrito",
        description: message,
      });
    } finally {
      setBusyProductId(null);
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
      <Card>
        <CardHeader>
          <CardTitle>Favoritos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Guarda productos para revisarlos luego o volver rapido al detalle.
          </p>
        </CardContent>
      </Card>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {products.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Todavia no guardaste productos en favoritos.
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const availableStock = product.stock - (product.reservedStock ?? 0);
            return (
              <Card key={product.id} className="overflow-hidden">
                <div className="relative h-48 bg-gradient-to-br from-slate-50 via-white to-slate-100">
                  {product.images[0]?.url ? (
                    <Image
                      src={product.images[0].url}
                      alt={product.images[0]?.altText ?? product.name}
                      fill
                      sizes="(min-width: 1280px) 28vw, (min-width: 640px) 42vw, 100vw"
                      quality={90}
                      className="object-contain p-4"
                    />
                  ) : null}
                </div>
                <CardContent className="space-y-4 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={productHref(product)} className="font-semibold hover:text-primary">
                        {product.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{product.category?.name ?? "Sin categoria"}</p>
                    </div>
                    <Badge tone={availableStock > 0 ? "success" : "danger"}>
                      {availableStock > 0 ? "Disponible" : "Sin stock"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-4 w-4 fill-current text-amber-400" />
                      {(product.averageRating ?? 0).toFixed(1)}
                    </span>
                    <span>{product.reviewCount ?? 0} reseñas</span>
                  </div>
                  <div className="text-lg font-semibold">{formatMoney(product.priceFrom ?? product.price)}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {product.hasVariants ? (
                      <Link href={productHref(product)}>
                        <Button className="w-full">Ver detalle</Button>
                      </Link>
                    ) : (
                      <Button className="w-full" disabled={busyProductId === product.id || availableStock <= 0} onClick={() => void addToCart(product)}>
                        <ShoppingCart className="h-4 w-4" />
                        Agregar
                      </Button>
                    )}
                    <Button variant="outline" className="w-full" disabled={busyProductId === product.id} onClick={() => void removeFromWishlist(product)}>
                      {busyProductId === product.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4 fill-current text-rose-500" />}
                      Quitar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
