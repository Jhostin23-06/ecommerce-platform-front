import type { MetadataRoute } from "next";
import type { PaginatedProducts, Tenant } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      changeFrequency: 'daily',
      priority: 1,
    },
  ];

  try {
    const tenantsResponse = await fetch(`${API_URL}/tenants`, { cache: 'no-store' });
    if (!tenantsResponse.ok) {
      return entries;
    }

    const tenants = (await tenantsResponse.json()) as Tenant[];
    for (const tenant of tenants.filter((entry) => entry.isActive)) {
      entries.push({
        url: `${SITE_URL}/tienda/${encodeURIComponent(tenant.slug)}`,
        changeFrequency: 'daily',
        priority: 0.9,
      });

      try {
        const productsResponse = await fetch(`${API_URL}/catalog/products?tenantId=${tenant.id}&page=1&limit=200&isActive=true`, {
          cache: 'no-store',
        });
        if (!productsResponse.ok) {
          continue;
        }
        const products = (await productsResponse.json()) as PaginatedProducts;
        for (const product of products.items) {
          entries.push({
            url: `${SITE_URL}/tienda/${encodeURIComponent(tenant.slug)}/producto/${encodeURIComponent(product.slug)}`,
            changeFrequency: 'daily',
            priority: 0.8,
          });
        }
      } catch {
        continue;
      }
    }
  } catch {
    return entries;
  }

  return entries;
}
