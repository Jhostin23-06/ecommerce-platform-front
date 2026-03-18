"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Heart, Loader2, Minus, Plus, ShoppingCart, Star } from "lucide-react";
import { ApiError, apiRequest, resolveTenantByKey } from "@/lib/api";
import { cartChanged, notify } from "@/lib/ui-events";
import { cn, formatMoney } from "@/lib/utils";
import type { Product, ProductReview, ProductReviewsResponse, ProductVariant, Tenant, WishlistResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function formatVariantOptions(variant: ProductVariant) {
  return variant.options.map((option) => `${option.name}: ${option.value}`).join(" | ");
}

export default function ProductDetailPage() {
  const params = useParams<{ tenantSlug: string; productSlug: string }>();
  const router = useRouter();
  const { authedRequest, user } = useAuth();

  const tenantKey = decodeURIComponent(params.tenantSlug);
  const productSlug = decodeURIComponent(params.productSlug);

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [reviewSummary, setReviewSummary] = useState({ averageRating: 0, reviewCount: 0 });
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [reviewRating, setReviewRating] = useState("5");
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [togglingWishlist, setTogglingWishlist] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedVariant = useMemo(
    () => product?.variants.find((variant) => variant.id === selectedVariantId) ?? null,
    [product, selectedVariantId],
  );

  const displayPrice = selectedVariant?.price ?? product?.priceFrom ?? product?.price ?? "0";
  const displayStock = selectedVariant
    ? selectedVariant.stock - selectedVariant.reservedStock
    : product
      ? product.stock - (product.reservedStock ?? 0)
      : 0;

  async function syncWishlist(tenantId: string, productId: string) {
    if (!user) {
      setIsWishlisted(false);
      return;
    }

    try {
      const wishlist = await authedRequest<WishlistResponse>(`/wishlist?tenantId=${tenantId}`);
      setIsWishlisted(wishlist.productIds.includes(productId));
    } catch {
      setIsWishlisted(false);
    }
  }

  async function loadProduct() {
    setLoading(true);
    setError(null);

    try {
      const tenantData = await resolveTenantByKey(tenantKey);
      const productData = await apiRequest<Product>(
        `/catalog/products/slug/${encodeURIComponent(productSlug)}?tenantId=${tenantData.id}`,
      );
      const reviewsData = await apiRequest<ProductReviewsResponse>(`/catalog/products/${productData.id}/reviews`);

      setTenant(tenantData);
      setProduct(productData);
      setSelectedVariantId(productData.variants[0]?.id ?? "");
      setSelectedImageIndex(0);
      setReviews(reviewsData.items);
      setReviewSummary({
        averageRating: reviewsData.averageRating,
        reviewCount: reviewsData.reviewCount,
      });
      await syncWishlist(tenantData.id, productData.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el producto";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, productSlug, user?.id]);

  async function addToCart() {
    if (!tenant || !product) {
      return;
    }

    setAdding(true);
    try {
      const updatedCart = await authedRequest<{ items: Array<{ quantity: number }> }>("/cart/items", {
        method: "POST",
        body: {
          tenantId: tenant.id,
          productId: product.id,
          productVariantId: selectedVariant?.id,
          quantity,
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
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      const message = err instanceof ApiError ? err.message : "No se pudo agregar al carrito";
      notify({
        tone: "error",
        title: "Carrito",
        description: message,
      });
    } finally {
      setAdding(false);
    }
  }

  async function toggleWishlist() {
    if (!tenant || !product) {
      return;
    }

    setTogglingWishlist(true);
    try {
      if (isWishlisted) {
        await authedRequest(`/wishlist/items/${product.id}`, {
          method: "DELETE",
          body: { tenantId: tenant.id },
        });
        setIsWishlisted(false);
      } else {
        await authedRequest(`/wishlist/items/${product.id}`, {
          method: "POST",
          body: { tenantId: tenant.id },
        });
        setIsWishlisted(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar favoritos";
      notify({
        tone: "error",
        title: "Favoritos",
        description: message,
      });
    } finally {
      setTogglingWishlist(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) {
      return;
    }

    setSavingReview(true);
    try {
      const review = await authedRequest<ProductReview>(`/catalog/products/${product.id}/reviews`, {
        method: "POST",
        body: {
          rating: Number(reviewRating),
          title: reviewTitle.trim() || undefined,
          comment: reviewComment.trim() || undefined,
        },
      });

      setReviews((previous) => {
        const withoutCurrent = previous.filter((entry) => entry.userId !== review.userId);
        return [review, ...withoutCurrent];
      });
      const nextReviewCount = reviews.some((entry) => entry.userId === review.userId)
        ? reviewSummary.reviewCount
        : reviewSummary.reviewCount + 1;
      const nextTotal = [...reviews.filter((entry) => entry.userId !== review.userId), review].reduce(
        (sum, entry) => sum + entry.rating,
        0,
      );
      setReviewSummary({
        averageRating: Number((nextTotal / Math.max(nextReviewCount, 1)).toFixed(1)),
        reviewCount: nextReviewCount,
      });
      setReviewTitle("");
      setReviewComment("");
      notify({
        tone: "success",
        title: "Reseña guardada",
        description: "Tu opinion ya aparece en el producto.",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      const message = err instanceof ApiError ? err.message : "No se pudo enviar la reseña";
      notify({
        tone: "error",
        title: "Reseñas",
        description: message,
      });
    } finally {
      setSavingReview(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !tenant || !product) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error ?? "Producto no encontrado"}</div>;
  }

  const selectedImage = product.images[selectedImageIndex] ?? product.images[0] ?? null;
  const quantityDisabled = displayStock <= 0;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border/80 bg-card/80 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href={`/tienda/${encodeURIComponent(tenant.slug)}`} className="hover:text-foreground">
            Volver a la tienda
          </Link>
          <span>/</span>
          <span>{product.name}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-slate-50 via-white to-slate-100">
              <div className="relative h-[420px] w-full">
                {selectedImage ? (
                  <Image
                    src={selectedImage.url}
                    alt={selectedImage.altText ?? product.name}
                    fill
                    sizes="(min-width: 1024px) 52vw, 100vw"
                    quality={95}
                    className="object-contain p-6"
                  />
                ) : null}
              </div>
            </div>
            {product.images.length > 1 ? (
              <div className="grid grid-cols-4 gap-2">
                {product.images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setSelectedImageIndex(index)}
                    className={cn(
                      "relative h-24 overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-50 via-white to-slate-100",
                      selectedImageIndex === index ? "border-primary" : "border-border",
                    )}
                  >
                    <Image
                      src={image.url}
                      alt={image.altText ?? product.name}
                      fill
                      sizes="25vw"
                      quality={85}
                      className="object-contain p-2"
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={displayStock > 0 ? "success" : "danger"}>
                  {displayStock > 0 ? "Disponible" : "Sin stock"}
                </Badge>
                {product.category?.name ? <Badge>{product.category.name}</Badge> : null}
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {product.description ?? "Producto sin descripcion extendida."}
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4 fill-current text-amber-400" />
                  {reviewSummary.averageRating.toFixed(1)}
                </span>
                <span>{reviewSummary.reviewCount} reseñas</span>
              </div>
              <div className="text-3xl font-semibold">{formatMoney(displayPrice)}</div>
            </div>

            {product.variants.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Elige una variante</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {product.variants.map((variant) => {
                    const variantAvailable = variant.stock - variant.reservedStock;
                    const isSelected = selectedVariantId === variant.id;
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => setSelectedVariantId(variant.id)}
                        className={cn(
                          "w-full rounded-2xl border p-4 text-left transition",
                          isSelected ? "border-primary bg-primary/5" : "border-border bg-card",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{variant.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{formatVariantOptions(variant) || "Sin atributos"}</div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="font-semibold">{formatMoney(variant.price)}</div>
                            <div className="text-muted-foreground">Stock: {Math.max(variantAvailable, 0)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            <div className="rounded-2xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              {selectedVariant ? formatVariantOptions(selectedVariant) : "Producto simple sin variantes."}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-full border border-border bg-card p-1">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full"
                  onClick={() => setQuantity((previous) => Math.max(previous - 1, 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-10 text-center text-sm font-semibold">{quantity}</span>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full"
                  onClick={() => setQuantity((previous) => Math.min(previous + 1, Math.max(displayStock, 1)))}
                  disabled={quantity >= Math.max(displayStock, 1)}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <Button className="flex-1" onClick={() => void addToCart()} disabled={adding || quantityDisabled}>
                {adding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Agregando...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-4 w-4" />
                    Agregar al carrito
                  </>
                )}
              </Button>

              <Button variant="outline" onClick={() => void toggleWishlist()} disabled={togglingWishlist}>
                {togglingWishlist ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={cn("h-4 w-4", isWishlisted && "fill-current text-rose-500")} />}
                {isWishlisted ? "En favoritos" : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Escribir reseña</CardTitle>
          </CardHeader>
          <CardContent>
            {user ? (
              <form className="space-y-3" onSubmit={submitReview}>
                <select
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={reviewRating}
                  onChange={(event) => setReviewRating(event.target.value)}
                >
                  <option value="5">5 estrellas</option>
                  <option value="4">4 estrellas</option>
                  <option value="3">3 estrellas</option>
                  <option value="2">2 estrellas</option>
                  <option value="1">1 estrella</option>
                </select>
                <Input value={reviewTitle} onChange={(event) => setReviewTitle(event.target.value)} placeholder="Titulo (opcional)" />
                <textarea
                  className="min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Cuenta que te parecio el producto"
                />
                <Button type="submit" disabled={savingReview}>
                  {savingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Guardar reseña
                </Button>
              </form>
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Inicia sesión para guardar favoritos y publicar reseñas.</p>
                <Link href="/login">
                  <Button variant="outline">Iniciar sesion</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reseñas del producto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavia no hay reseñas para este producto.</p>
            ) : (
              reviews.map((review) => (
                <div key={review.id} className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{review.title ?? review.authorName ?? "Cliente"}</p>
                      <p className="text-xs text-muted-foreground">{review.authorName ?? "Cliente"}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-4 w-4 fill-current text-amber-400" />
                        {review.rating.toFixed(1)}
                      </span>
                      {review.isVerifiedPurchase ? <Badge tone="success">Compra verificada</Badge> : null}
                    </div>
                  </div>
                  {review.comment ? <p className="mt-3 text-sm text-muted-foreground">{review.comment}</p> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
