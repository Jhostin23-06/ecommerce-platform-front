"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Heart, Loader2, Search, ShoppingCart, SlidersHorizontal, Star, Tag, X } from "lucide-react";
import { ApiError, apiRequest, resolveTenantByKey } from "@/lib/api";
import { cartChanged, notify } from "@/lib/ui-events";
import { cn, formatMoney } from "@/lib/utils";
import type { Category, PaginatedProducts, Product, PublicCouponPromotion, Tenant, WishlistResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ProductSortOption = "newest" | "oldest" | "price_asc" | "price_desc" | "rating_desc" | "name_asc";

function formatProductPrice(product: Product) {
  const priceFrom = product.priceFrom ?? product.price;
  const priceTo = product.priceTo ?? product.price;
  if (priceFrom !== priceTo) {
    return `${formatMoney(priceFrom)} - ${formatMoney(priceTo)}`;
  }
  return formatMoney(priceFrom);
}

function buildProductHref(tenantKey: string, product: Product) {
  return `/tienda/${encodeURIComponent(tenantKey)}/producto/${encodeURIComponent(product.slug)}`;
}

export default function StorePage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const { authedRequest, user } = useAuth();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<PublicCouponPromotion[]>([]);
  const [wishlistProductIds, setWishlistProductIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<ProductSortOption>("newest");
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [filtersTouched, setFiltersTouched] = useState(false);
  const [togglingWishlistId, setTogglingWishlistId] = useState<string | null>(null);
  const [activePromotionIndex, setActivePromotionIndex] = useState(0);
  const [dismissedPromotionIds, setDismissedPromotionIds] = useState<string[]>([]);
  const filterRequestIdRef = useRef(0);

  const tenantKey = decodeURIComponent(params.tenantSlug);

  async function syncWishlist(tenantId: string) {
    if (!user) {
      setWishlistProductIds([]);
      return;
    }

    try {
      const wishlist = await authedRequest<WishlistResponse>(`/wishlist?tenantId=${tenantId}`);
      setWishlistProductIds(wishlist.productIds);
    } catch {
      setWishlistProductIds([]);
    }
  }

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const tenantData = await resolveTenantByKey(tenantKey);
      setTenant(tenantData);

      const [categoriesData, productsData, promotionsData] = await Promise.all([
        apiRequest<Category[]>(`/catalog/categories?tenantId=${tenantData.id}`),
        apiRequest<PaginatedProducts>(
          `/catalog/products?tenantId=${tenantData.id}&page=1&limit=50&isActive=true&sortBy=${sortBy}`,
        ),
        apiRequest<PublicCouponPromotion[]>(`/coupons/public?tenantId=${tenantData.id}`),
      ]);

      setCategories(categoriesData);
      setProducts(productsData.items);
      setPromotions(promotionsData);
      await syncWishlist(tenantData.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar la tienda";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, user?.id]);

  async function runProductFilter(tenantId: string) {
    const requestId = ++filterRequestIdRef.current;
    setFiltering(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        tenantId,
        page: "1",
        limit: "50",
        isActive: "true",
        sortBy,
      });
      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (categoryId) {
        params.set("categoryId", categoryId);
      }
      if (minPrice.trim()) {
        params.set("minPrice", minPrice.trim());
      }
      if (maxPrice.trim()) {
        params.set("maxPrice", maxPrice.trim());
      }
      if (inStockOnly) {
        params.set("inStock", "true");
      }

      const result = await apiRequest<PaginatedProducts>(`/catalog/products?${params.toString()}`);
      if (requestId !== filterRequestIdRef.current) {
        return;
      }
      setProducts(result.items);
    } catch (err) {
      if (requestId !== filterRequestIdRef.current) {
        return;
      }
      const message = err instanceof ApiError ? err.message : "No se pudo filtrar productos";
      setError(message);
    } finally {
      if (requestId === filterRequestIdRef.current) {
        setFiltering(false);
      }
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    setFiltersTouched(true);
    await runProductFilter(tenant.id);
  }

  useEffect(() => {
    if (!tenant || !filtersTouched) {
      return;
    }

    const timeout = setTimeout(() => {
      void runProductFilter(tenant.id);
    }, 300);

    return () => clearTimeout(timeout);
  }, [categoryId, filtersTouched, inStockOnly, maxPrice, minPrice, search, sortBy, tenant]);

  const visiblePromotions = useMemo(
    () => promotions.filter((promotion) => !dismissedPromotionIds.includes(promotion.id)),
    [dismissedPromotionIds, promotions],
  );
  const activePromotion =
    visiblePromotions.length > 0 ? visiblePromotions[activePromotionIndex % visiblePromotions.length] : null;

  useEffect(() => {
    if (visiblePromotions.length <= 1) {
      return;
    }

    const timer = setInterval(() => {
      setActivePromotionIndex((previous) => (previous + 1) % visiblePromotions.length);
    }, 6000);

    return () => clearInterval(timer);
  }, [visiblePromotions.length]);

  async function addToCart(productId: string) {
    setAddingProductId(productId);
    setError(null);
    try {
      const updatedCart = await authedRequest<{ items: Array<{ quantity: number }> }>("/cart/items", {
        method: "POST",
        body: {
          tenantId: tenant?.id,
          productId,
          quantity: 1,
        },
      });
      const product = products.find((entry) => entry.id === productId);
      const itemsCount = updatedCart.items.reduce((total, item) => total + item.quantity, 0);
      cartChanged({ itemsCount });
      notify({
        tone: "success",
        title: "Producto agregado",
        description: product ? `${product.name} se agrego al carrito.` : "Se agrego al carrito.",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      const message = err instanceof ApiError ? err.message : "No se pudo agregar al carrito";
      setError(message);
      notify({
        tone: "error",
        title: "No se pudo agregar",
        description: message,
      });
    } finally {
      setAddingProductId(null);
    }
  }

  async function toggleWishlist(productId: string) {
    if (!tenant) {
      return;
    }

    const isInWishlist = wishlistProductIds.includes(productId);
    setTogglingWishlistId(productId);
    try {
      if (isInWishlist) {
        await authedRequest(`/wishlist/items/${productId}`, {
          method: "DELETE",
          body: { tenantId: tenant.id },
        });
        setWishlistProductIds((previous) => previous.filter((entry) => entry !== productId));
      } else {
        await authedRequest(`/wishlist/items/${productId}`, {
          method: "POST",
          body: { tenantId: tenant.id },
        });
        setWishlistProductIds((previous) => [...previous, productId]);
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
      setTogglingWishlistId(null);
    }
  }

  function clearFilters() {
    setFiltersTouched(true);
    setSearch("");
    setCategoryId("");
    setMinPrice("");
    setMaxPrice("");
    setInStockOnly(false);
    setSortBy("newest");
  }

  const headerTitle = useMemo(() => (tenant ? `Tienda ${tenant.name}` : "Tienda"), [tenant]);
  const productCountLabel = `${products.length} producto${products.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6">
      <section className="fade-up rounded-3xl border border-border/80 bg-card/70 p-5 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
              Catalogo publico
            </p>
            <h1 className="text-3xl font-bold">{headerTitle}</h1>
            <p className="text-sm text-muted-foreground">
              Explora el catalogo, guarda favoritos y entra al detalle para comparar variantes, stock y reseñas.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/favoritos">
              <Button variant="outline">Favoritos</Button>
            </Link>
            <Link href={`/carrito/${tenant?.slug ?? tenantKey}`}>
              <Button variant="primary">
                <ShoppingCart className="h-4 w-4" />
                Ver carrito
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Busqueda avanzada</CardTitle>
              <p className="text-sm text-muted-foreground">{productCountLabel} visibles segun tus filtros.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtrado dinamico
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="grid gap-3 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <Input
                value={search}
                onChange={(event) => {
                  setFiltersTouched(true);
                  setSearch(event.target.value);
                }}
                placeholder="Buscar por nombre, SKU o variante"
              />
            </div>
            <select
              className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
              value={categoryId}
              onChange={(event) => {
                setFiltersTouched(true);
                setCategoryId(event.target.value);
              }}
            >
              <option value="">Todas las categorias</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={minPrice}
              onChange={(event) => {
                setFiltersTouched(true);
                setMinPrice(event.target.value);
              }}
              placeholder="Precio min"
            />
            <Input
              type="number"
              min={0}
              step={0.01}
              value={maxPrice}
              onChange={(event) => {
                setFiltersTouched(true);
                setMaxPrice(event.target.value);
              }}
              placeholder="Precio max"
            />
            <select
              className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
              value={sortBy}
              onChange={(event) => {
                setFiltersTouched(true);
                setSortBy(event.target.value as ProductSortOption);
              }}
            >
              <option value="newest">Mas recientes</option>
              <option value="price_asc">Precio ascendente</option>
              <option value="price_desc">Precio descendente</option>
              <option value="rating_desc">Mejor valorados</option>
              <option value="name_asc">Nombre A-Z</option>
              <option value="oldest">Mas antiguos</option>
            </select>
            <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm lg:col-span-2">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(event) => {
                  setFiltersTouched(true);
                  setInStockOnly(event.target.checked);
                }}
              />
              Solo mostrar disponibles
            </label>
            <Button type="submit" variant="outline" disabled={filtering || loading}>
              {filtering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {filtering ? "Filtrando..." : "Aplicar filtros"}
            </Button>
            <Button type="button" variant="ghost" onClick={clearFilters} disabled={filtering || loading}>
              Limpiar
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No hay productos para esos filtros.
        </div>
      ) : (
        <section className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", filtering && "opacity-70")}>
          {products.map((product) => {
            const imageUrl = product.images[0]?.url;
            const detailHref = buildProductHref(tenant?.slug ?? tenantKey, product);
            const isInWishlist = wishlistProductIds.includes(product.id);
            const availableStock = product.stock - (product.reservedStock ?? 0);

            return (
              <Card key={product.id} className="overflow-hidden border-border/80 bg-card/90">
                <div className="relative h-52 w-full">
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt={product.images[0]?.altText ?? product.name}
                      fill
                      sizes="(min-width: 1280px) 28vw, (min-width: 640px) 42vw, 100vw"
                      quality={90}
                      className="object-cover object-center"
                    />
                  ) : null}
                  <button
                    type="button"
                    className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/90 text-foreground shadow-sm"
                    onClick={() => void toggleWishlist(product.id)}
                    disabled={togglingWishlistId === product.id}
                    aria-label={isInWishlist ? "Quitar de favoritos" : "Agregar a favoritos"}
                  >
                    {togglingWishlistId === product.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Heart className={cn("h-4 w-4", isInWishlist && "fill-current text-rose-500")} />
                    )}
                  </button>
                </div>

                <CardContent className="space-y-4 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={detailHref} className="text-base font-semibold transition hover:text-primary">
                        {product.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {product.category?.name ?? "Sin categoria"}
                      </p>
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
                    {product.hasVariants ? <span>{product.variants.length} variantes</span> : null}
                  </div>

                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {product.description ?? "Producto sin descripcion"}
                  </p>

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{formatProductPrice(product)}</div>
                      <p className="text-xs text-muted-foreground">Stock visible: {Math.max(availableStock, 0)}</p>
                    </div>
                    <Link href={detailHref} className="text-sm font-medium text-primary">
                      Ver detalle
                    </Link>
                  </div>

                  {product.hasVariants ? (
                    <Button className="w-full" onClick={() => router.push(detailHref)}>
                      Elegir variante
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={addingProductId === product.id || availableStock <= 0}
                      onClick={() => void addToCart(product.id)}
                    >
                      {addingProductId === product.id ? (
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
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {activePromotion ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-1.5rem))]">
          <div className="pointer-events-auto overflow-hidden rounded-[1.75rem] border border-amber-300/60 bg-[linear-gradient(135deg,rgba(255,247,237,0.98),rgba(254,215,170,0.95))] shadow-[0_24px_80px_-28px_rgba(217,119,6,0.55)] backdrop-blur">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.28),transparent_42%)]" />
            <div className="relative space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-900">
                  <Tag className="h-3.5 w-3.5" />
                  Oferta activa
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-400/30 bg-white/65 text-amber-900 transition hover:bg-white"
                  onClick={() => setDismissedPromotionIds((previous) => [...previous, activePromotion.id])}
                  aria-label="Ocultar promoción"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-1">
                <p className="text-lg font-black tracking-tight text-amber-950">{activePromotion.headline}</p>
                <p className="text-sm leading-6 text-amber-900/85">{activePromotion.details}</p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-950 px-3 py-1.5 text-sm font-semibold text-amber-50">
                  Codigo: {activePromotion.code}
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-amber-950 transition hover:text-amber-700"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                >
                  Ver productos
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
