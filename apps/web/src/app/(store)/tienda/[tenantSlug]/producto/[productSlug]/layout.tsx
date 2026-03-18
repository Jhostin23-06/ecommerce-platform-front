import type { Metadata } from "next";
import type { Product, Tenant } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

async function fetchTenant(tenantKey: string): Promise<Tenant | null> {
  try {
    const response = await fetch(`${API_URL}/tenants`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const tenants = (await response.json()) as Tenant[];
    return tenants.find((tenant) => tenant.slug === tenantKey || tenant.id === tenantKey) ?? null;
  } catch {
    return null;
  }
}

async function fetchProduct(tenantId: string, productSlug: string): Promise<Product | null> {
  try {
    const response = await fetch(`${API_URL}/catalog/products/slug/${encodeURIComponent(productSlug)}?tenantId=${tenantId}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Product;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, productSlug } = await params;
  const tenant = await fetchTenant(decodeURIComponent(tenantSlug));
  if (!tenant) {
    return {};
  }

  const product = await fetchProduct(tenant.id, decodeURIComponent(productSlug));
  if (!product) {
    return {};
  }

  const price = product.priceFrom ?? product.price;
  const title = `${product.name} | ${tenant.name}`;
  const description = product.description ?? `Compra ${product.name} en ${tenant.name}.`;
  const canonicalPath = `/tienda/${encodeURIComponent(tenant.slug)}/producto/${encodeURIComponent(product.slug)}`;
  const image = product.images[0]?.url;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}${canonicalPath}`,
      images: image ? [{ url: image, alt: product.name }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
    keywords: [tenant.name, product.name, product.category?.name ?? "ecommerce", `PEN ${price}`],
  };
}

export default async function ProductSeoLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string; productSlug: string }>;
}>) {
  const { tenantSlug, productSlug } = await params;
  const tenant = await fetchTenant(decodeURIComponent(tenantSlug));
  const product = tenant ? await fetchProduct(tenant.id, decodeURIComponent(productSlug)) : null;

  const schema = product && tenant
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description ?? undefined,
        image: product.images.map((image) => image.url),
        sku: product.sku ?? undefined,
        brand: {
          '@type': 'Brand',
          name: tenant.name,
        },
        aggregateRating:
          typeof product.averageRating === 'number' && typeof product.reviewCount === 'number' && product.reviewCount > 0
            ? {
                '@type': 'AggregateRating',
                ratingValue: product.averageRating,
                reviewCount: product.reviewCount,
              }
            : undefined,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'PEN',
          price: product.priceFrom ?? product.price,
          availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: `${SITE_URL}/tienda/${encodeURIComponent(tenant.slug)}/producto/${encodeURIComponent(product.slug)}`,
        },
      }
    : null;

  return (
    <>
      {schema ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      ) : null}
      {children}
    </>
  );
}
