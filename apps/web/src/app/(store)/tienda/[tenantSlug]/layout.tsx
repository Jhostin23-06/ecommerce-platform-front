import type { Metadata } from "next";
import type { Tenant } from "@/lib/types";

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

export async function generateMetadata({ params }: { params: Promise<{ tenantSlug: string }> }): Promise<Metadata> {
  const { tenantSlug } = await params;
  const tenant = await fetchTenant(decodeURIComponent(tenantSlug));

  if (!tenant) {
    return {
      title: "Tienda | Ecommerce Platform",
      description: "Catalogo ecommerce multiempresa",
    };
  }

  const title = `${tenant.name} | Tienda online`;
  const description = `Compra en ${tenant.name}: catalogo con productos, variantes, reseñas y checkout online.`;
  const canonicalPath = `/tienda/${encodeURIComponent(tenant.slug)}`;

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
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function TenantStoreLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
