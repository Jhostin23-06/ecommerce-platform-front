"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, ChevronDown, Download, Loader2, RefreshCw, ShieldAlert, Sparkles, Upload } from "lucide-react";
import { ApiError, apiRequest, resolveTenantByKey } from "@/lib/api";
import { cn, formatMoney, slugify } from "@/lib/utils";
import type {
  Category,
  AnalyticsOverview,
  Coupon,
  DeliveryZone,
  FulfillmentStatus,
  Order,
  OrderReturn,
  PaginatedProducts,
  PickupPoint,
  Product,
  Tenant,
  TenantCustomer,
  User,
} from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import {
  OrderRefundModal,
  type RefundOrderModalState,
} from "@/components/admin/order-refund-modal";
import {
  ReturnActionModal,
  type ReturnActionModalState,
  type ReturnActionStatus,
} from "@/components/admin/return-action-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ADMIN_ROLES = new Set(["platform_superadmin", "tenant_admin", "catalog_manager", "order_manager", "support"]);
const BILLING_VIEW_ROLES = new Set(["platform_superadmin", "tenant_admin", "order_manager", "support"]);
const BILLING_EDIT_ROLES = new Set(["platform_superadmin", "tenant_admin"]);
const BILLING_ISSUE_ROLES = new Set(["platform_superadmin", "tenant_admin", "order_manager", "support"]);
type AdminTab = "catalogo" | "ventas" | "logistica" | "crecimiento" | "facturacion" | "usuarios";
type ProductVariantDraft = {
  id?: string;
  name: string;
  price: string;
  stock: string;
  sku: string;
  optionsText: string;
  isActive: boolean;
  sortOrder: number;
};

type ProductDraft = {
  name: string;
  slug: string;
  description: string;
  price: string;
  stock: string;
  categoryId: string;
  sku: string;
  isActive: boolean;
  variants: ProductVariantDraft[];
};

type CouponDraft = {
  code: string;
  type: "percentage" | "fixed";
  scope: "order" | "volume" | "bundle";
  value: string;
  isActive: boolean;
  minQuantity: string;
  productIds: string[];
  categoryIds: string[];
  requiredProductIds: string[];
  requiredCategoryIds: string[];
};

type BillingSettingsResponse = {
  configured: boolean;
  id?: string;
  tenantId?: string;
  provider?: "demo" | "nubefact";
  environment?: "demo" | "production";
  isActive?: boolean;
  issuerRuc?: string | null;
  issuerBusinessName?: string | null;
  issuerAddress?: string | null;
  invoiceSeries?: string | null;
  receiptSeries?: string | null;
  creditNoteSeries?: string | null;
  apiBaseUrl?: string | null;
  apiTokenConfigured?: boolean;
  updatedAt?: string;
};

type BillingDraft = {
  provider: "demo" | "nubefact";
  environment: "demo" | "production";
  isActive: boolean;
  issuerRuc: string;
  issuerBusinessName: string;
  issuerAddress: string;
  invoiceSeries: string;
  receiptSeries: string;
  creditNoteSeries: string;
  apiBaseUrl: string;
  apiToken: string;
};

type CouponAdvancedSectionState = Record<
  string,
  {
    target: boolean;
    bundle: boolean;
  }
>;

function createDefaultBillingDraft(): BillingDraft {
  return {
    provider: "demo",
    environment: "demo",
    isActive: false,
    issuerRuc: "",
    issuerBusinessName: "",
    issuerAddress: "",
    invoiceSeries: "F001",
    receiptSeries: "B001",
    creditNoteSeries: "FC01",
    apiBaseUrl: "",
    apiToken: "",
  };
}

function toBillingDraft(settings: BillingSettingsResponse | null): BillingDraft {
  if (!settings || !settings.configured) {
    return createDefaultBillingDraft();
  }

  const useNubefactDemoSeries = settings.provider === "nubefact" && settings.environment === "demo";
  const defaultInvoiceSeries = useNubefactDemoSeries ? "FFF1" : "F001";
  const defaultReceiptSeries = useNubefactDemoSeries ? "BBB1" : "B001";

  return {
    provider: settings.provider ?? "demo",
    environment: settings.environment ?? "demo",
    isActive: Boolean(settings.isActive),
    issuerRuc: settings.issuerRuc ?? "",
    issuerBusinessName: settings.issuerBusinessName ?? "",
    issuerAddress: settings.issuerAddress ?? "",
    invoiceSeries: settings.invoiceSeries ?? defaultInvoiceSeries,
    receiptSeries: settings.receiptSeries ?? defaultReceiptSeries,
    creditNoteSeries: settings.creditNoteSeries ?? "FC01",
    apiBaseUrl: settings.apiBaseUrl ?? "",
    apiToken: "",
  };
}

const ADMIN_TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "catalogo", label: "Catalogo" },
  { id: "ventas", label: "Ventas" },
  { id: "logistica", label: "Logistica" },
  { id: "crecimiento", label: "Crecimiento" },
  { id: "facturacion", label: "Facturacion" },
  { id: "usuarios", label: "Usuarios" },
];

function isAdminTab(value: string | null): value is AdminTab {
  return (
    value === "catalogo" ||
    value === "ventas" ||
    value === "logistica" ||
    value === "crecimiento" ||
    value === "facturacion" ||
    value === "usuarios"
  );
}

function formatPaymentStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "paid") {
    return "pagado";
  }
  if (normalized === "partially_refunded") {
    return "reembolso parcial";
  }
  if (normalized === "refunded") {
    return "reembolsado";
  }
  if (normalized === "unpaid") {
    return "no pagado";
  }
  if (normalized === "pending") {
    return "pendiente";
  }
  if (normalized === "failed") {
    return "fallido";
  }
  return status;
}

function formatBillingDocumentStatus(status: Order["billingDocumentStatus"]) {
  if (status === "issued") return "comprobante emitido";
  if (status === "failed") return "emision fallida";
  if (status === "missing_configuration") return "sin configuracion";
  if (status === "pending") return "emision pendiente";
  return "sin estado";
}

function billingDocumentTone(status: Order["billingDocumentStatus"]): "success" | "warning" | "neutral" {
  if (status === "issued") return "success";
  if (status === "failed" || status === "missing_configuration") return "warning";
  return "neutral";
}

function formatOrderLifecycleStatus(status: Order["lifecycleStatus"]) {
  if (status === "pending") return "pendiente";
  if (status === "paid") return "pagado";
  if (status === "preparing") return "preparando";
  if (status === "shipped") return "enviado";
  if (status === "delivered") return "entregado";
  if (status === "cancelled") return "cancelado";
  return status;
}

function orderLifecycleTone(status: Order["lifecycleStatus"]): "success" | "warning" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "cancelled") return "warning";
  return "neutral";
}

function formatFulfillmentStatus(status: FulfillmentStatus) {
  if (status === "pending") return "pendiente";
  if (status === "preparing") return "preparando";
  if (status === "ready_for_dispatch") return "listo para despacho";
  if (status === "on_the_way") return "en ruta";
  if (status === "ready_for_pickup") return "listo para recojo";
  if (status === "completed") return "completado";
  if (status === "failed") return "fallido";
  return status;
}

function fulfillmentTone(status: FulfillmentStatus): "success" | "warning" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return "warning";
  return "neutral";
}

function formatReturnStatus(status: OrderReturn["status"]) {
  if (status === "requested") return "solicitada";
  if (status === "approved") return "aprobada";
  if (status === "pickup_pending") return "recojo pendiente";
  if (status === "pickup_assigned") return "recojo asignado";
  if (status === "picked_up") return "recogido";
  if (status === "received") return "recibido en almacen";
  if (status === "rejected") return "rechazada";
  if (status === "refunded") return "reembolsada";
  return status;
}

function toLocalDateTimeInput(isoValue: string): string {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseApiErrorMessage(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message) && parsed.message.length) {
      const first = parsed.message.find((entry) => typeof entry === "string");
      if (first) {
        return first;
      }
    }
    return fallback;
  } catch {
    return text.trim() || fallback;
  }
}

function readMultiSelectValues(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function deriveCategoryIdsFromProducts(productIds: string[], products: Product[]) {
  if (!productIds.length) {
    return [];
  }

  const selectedIds = new Set(productIds);
  const categoryIds = new Set<string>();
  for (const product of products) {
    if (selectedIds.has(product.id) && product.categoryId) {
      categoryIds.add(product.categoryId);
    }
  }
  return Array.from(categoryIds);
}

function filterIdsByAllowedValues(selectedIds: string[], allowedIds: string[]) {
  if (!selectedIds.length) {
    return selectedIds;
  }

  const allowed = new Set(allowedIds);
  const next = selectedIds.filter((id) => allowed.has(id));
  if (next.length === selectedIds.length) {
    return selectedIds;
  }
  return next;
}

function normalizeCategoryIdsForProducts(categoryIds: string[], productIds: string[], products: Product[]) {
  if (!productIds.length || !categoryIds.length) {
    return categoryIds;
  }

  return filterIdsByAllowedValues(categoryIds, deriveCategoryIdsFromProducts(productIds, products));
}

function findIncompatibleCategoryIds(categoryIds: string[], productIds: string[], products: Product[]) {
  if (!productIds.length || !categoryIds.length) {
    return [];
  }

  const allowedCategoryIds = new Set(deriveCategoryIdsFromProducts(productIds, products));
  return categoryIds.filter((id) => !allowedCategoryIds.has(id));
}

function buildCategoryMismatchMessage(
  categoryIds: string[],
  productIds: string[],
  products: Product[],
  categoryNameById: Map<string, string>,
  label: string,
) {
  const incompatibleIds = findIncompatibleCategoryIds(categoryIds, productIds, products);
  if (!incompatibleIds.length) {
    return null;
  }

  const names = incompatibleIds.map((id) => categoryNameById.get(id) ?? `Categoria ${id.slice(0, 8)}`);
  const subject = incompatibleIds.length === 1 ? "La categoria" : "Las categorias";
  const verb = incompatibleIds.length === 1 ? "no coincide" : "no coinciden";
  return `${subject} ${names.join(", ")} ${verb} con los productos seleccionados en ${label}.`;
}

function resolveCompatibleCategories(productIds: string[], products: Product[], categories: Category[]) {
  if (!productIds.length) {
    return categories;
  }

  const compatibleCategoryIds = new Set(deriveCategoryIdsFromProducts(productIds, products));
  return categories.filter((category) => compatibleCategoryIds.has(category.id));
}

function resolveReferenceLabels(ids: string[], labels: Map<string, string>, fallbackLabel: string) {
  return ids.map((id) => labels.get(id) ?? `${fallbackLabel} ${id.slice(0, 8)}`);
}

function renderScopeLabel(scope: Coupon["scope"]) {
  if (scope === "order") {
    return "Pedido completo";
  }
  if (scope === "volume") {
    return "Volumen";
  }
  return "Bundle";
}

function SelectionBadgeList({
  labels,
  emptyLabel,
  tone = "neutral",
}: {
  labels: string[];
  emptyLabel: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  if (!labels.length) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((label, index) => (
        <Badge key={`${label}-${index}`} tone={tone}>
          {label}
        </Badge>
      ))}
    </div>
  );
}

function summarizeCouponRules(coupon: Coupon, products: Product[], categories: Category[]) {
  if (coupon.scope === "order" || !coupon.rules) {
    return "Aplica al total del pedido";
  }

  const productNameById = new Map(products.map((product) => [product.id, product.name]));
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const parts: string[] = [];

  if (coupon.scope === "volume" && coupon.rules.minQuantity) {
    parts.push(`min ${coupon.rules.minQuantity} unidades`);
  }
  if (coupon.rules.productIds?.length) {
    parts.push(`productos: ${coupon.rules.productIds.map((id) => productNameById.get(id) ?? id.slice(0, 8)).join(", ")}`);
  }
  if (coupon.rules.categoryIds?.length) {
    parts.push(`categorias: ${coupon.rules.categoryIds.map((id) => categoryNameById.get(id) ?? id.slice(0, 8)).join(", ")}`);
  }
  if (coupon.rules.requiredProductIds?.length) {
    parts.push(`bundle productos: ${coupon.rules.requiredProductIds.map((id) => productNameById.get(id) ?? id.slice(0, 8)).join(", ")}`);
  }
  if (coupon.rules.requiredCategoryIds?.length) {
    parts.push(`bundle categorias: ${coupon.rules.requiredCategoryIds.map((id) => categoryNameById.get(id) ?? id.slice(0, 8)).join(", ")}`);
  }

  return parts.join(" | ") || "Reglas avanzadas";
}

function createCouponDraft(coupon: Coupon): CouponDraft {
  return {
    code: coupon.code,
    type: coupon.type,
    scope: coupon.scope,
    value: coupon.value,
    isActive: coupon.isActive,
    minQuantity: coupon.rules?.minQuantity ? String(coupon.rules.minQuantity) : "2",
    productIds: coupon.rules?.productIds ?? [],
    categoryIds: coupon.rules?.categoryIds ?? [],
    requiredProductIds: coupon.rules?.requiredProductIds ?? [],
    requiredCategoryIds: coupon.rules?.requiredCategoryIds ?? [],
  };
}

function normalizeCouponDraftCategorySelections(draft: CouponDraft, products: Product[]): CouponDraft {
  const categoryIds = normalizeCategoryIdsForProducts(draft.categoryIds, draft.productIds, products);
  const requiredCategoryIds = normalizeCategoryIdsForProducts(draft.requiredCategoryIds, draft.requiredProductIds, products);

  if (categoryIds === draft.categoryIds && requiredCategoryIds === draft.requiredCategoryIds) {
    return draft;
  }

  return {
    ...draft,
    categoryIds,
    requiredCategoryIds,
  };
}

function createEmptyVariantDraft(sortOrder: number): ProductVariantDraft {
  return {
    name: "",
    price: "0",
    stock: "0",
    sku: "",
    optionsText: "",
    isActive: true,
    sortOrder,
  };
}

function formatVariantOptionsText(options: Array<{ name: string; value: string }>): string {
  return options.map((option) => `${option.name}: ${option.value}`).join(", ");
}

function parseVariantOptions(optionsText: string) {
  return optionsText
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex === -1) {
        return { name: "atributo", value: entry };
      }
      return {
        name: entry.slice(0, separatorIndex).trim() || "atributo",
        value: entry.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.value.length > 0);
}

function deriveProductMetricsFromVariants(variants: ProductVariantDraft[]) {
  if (!variants.length) {
    return { price: "0", stock: "0" };
  }

  const price = Math.min(...variants.map((variant) => Number(variant.price || 0))).toFixed(2);
  const stock = String(variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0));
  return { price, stock };
}

export default function AdminTenantPage() {
  const params = useParams<{ tenantSlug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: authLoading, user, accessToken, authedRequest } = useAuth();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderReturns, setOrderReturns] = useState<OrderReturn[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [customers, setCustomers] = useState<TenantCustomer[]>([]);
  const [analyticsOverview, setAnalyticsOverview] = useState<AnalyticsOverview | null>(null);
  const [billingSettings, setBillingSettings] = useState<BillingSettingsResponse | null>(null);
  const [billingDraft, setBillingDraft] = useState<BillingDraft>(() => createDefaultBillingDraft());
  const [billingSaveMessage, setBillingSaveMessage] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductSlug, setNewProductSlug] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("0");
  const [newProductStock, setNewProductStock] = useState("0");
  const [newProductCategoryId, setNewProductCategoryId] = useState("");
  const [newProductImage, setNewProductImage] = useState<File | null>(null);
  const [newProductVariants, setNewProductVariants] = useState<ProductVariantDraft[]>([]);
  const [newCouponCode, setNewCouponCode] = useState("");
  const [newCouponType, setNewCouponType] = useState<"percentage" | "fixed">("percentage");
  const [newCouponScope, setNewCouponScope] = useState<"order" | "volume" | "bundle">("order");
  const [newCouponValue, setNewCouponValue] = useState("10");
  const [newCouponMinQuantity, setNewCouponMinQuantity] = useState("2");
  const [newCouponProductIds, setNewCouponProductIds] = useState<string[]>([]);
  const [newCouponCategoryIds, setNewCouponCategoryIds] = useState<string[]>([]);
  const [newCouponRequiredProductIds, setNewCouponRequiredProductIds] = useState<string[]>([]);
  const [newCouponRequiredCategoryIds, setNewCouponRequiredCategoryIds] = useState<string[]>([]);
  const [showNewCouponCategoryFilters, setShowNewCouponCategoryFilters] = useState(false);
  const [showNewCouponRequiredCategoryFilters, setShowNewCouponRequiredCategoryFilters] = useState(false);
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  const [couponDrafts, setCouponDrafts] = useState<Record<string, CouponDraft>>({});
  const [couponAdvancedSections, setCouponAdvancedSections] = useState<CouponAdvancedSectionState>({});
  const [newDeliveryZoneName, setNewDeliveryZoneName] = useState("");
  const [newDeliveryZoneDistricts, setNewDeliveryZoneDistricts] = useState("");
  const [newDeliveryZoneFee, setNewDeliveryZoneFee] = useState("10");
  const [newDeliveryZoneMinOrder, setNewDeliveryZoneMinOrder] = useState("0");
  const [newDeliveryZoneFreeFrom, setNewDeliveryZoneFreeFrom] = useState("");
  const [newDeliveryZoneEtaMinutes, setNewDeliveryZoneEtaMinutes] = useState("180");
  const [newDeliveryZoneSortOrder, setNewDeliveryZoneSortOrder] = useState("0");
  const [newPickupPointName, setNewPickupPointName] = useState("");
  const [newPickupPointAddress, setNewPickupPointAddress] = useState("");
  const [newPickupPointWindows, setNewPickupPointWindows] = useState("");
  const [newPickupPointSort, setNewPickupPointSort] = useState("0");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [courierDrafts, setCourierDrafts] = useState<Record<string, { name: string; phone: string }>>({});
  const [activeTab, setActiveTab] = useState<AdminTab>("catalogo");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [returnActionModal, setReturnActionModal] = useState<ReturnActionModalState | null>(null);
  const [refundOrderModal, setRefundOrderModal] = useState<RefundOrderModalState | null>(null);
  const [modalAdminNote, setModalAdminNote] = useState("");
  const [modalRefundAmount, setModalRefundAmount] = useState("");
  const [modalPickupCourierName, setModalPickupCourierName] = useState("");
  const [modalPickupCourierPhone, setModalPickupCourierPhone] = useState("");
  const [modalPickupScheduledAt, setModalPickupScheduledAt] = useState("");
  const [modalPickupCompletedAt, setModalPickupCompletedAt] = useState("");
  const [modalRefundReason, setModalRefundReason] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [pdfOrderIdLoading, setPdfOrderIdLoading] = useState<string | null>(null);
  const [couponDeleteModal, setCouponDeleteModal] = useState<Coupon | null>(null);

  const tenantKey = decodeURIComponent(params.tenantSlug);

  const canAccessAdmin = useMemo(() => {
    if (!user) {
      return false;
    }
    return ADMIN_ROLES.has(user.role);
  }, [user]);

  const canViewBilling = useMemo(() => {
    if (!user) {
      return false;
    }
    return BILLING_VIEW_ROLES.has(user.role);
  }, [user]);

  const canEditBilling = useMemo(() => {
    if (!user) {
      return false;
    }
    return BILLING_EDIT_ROLES.has(user.role);
  }, [user]);

  const canIssueBillingDocuments = useMemo(() => {
    if (!user) {
      return false;
    }
    return BILLING_ISSUE_ROLES.has(user.role);
  }, [user]);

  const productNameById = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);
  const categoryNameById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);

  const newCouponProductLabels = useMemo(
    () => resolveReferenceLabels(newCouponProductIds, productNameById, "Producto"),
    [newCouponProductIds, productNameById],
  );
  const newCouponDetectedCategoryLabels = useMemo(
    () =>
      resolveReferenceLabels(
        deriveCategoryIdsFromProducts(newCouponProductIds, products),
        categoryNameById,
        "Categoria",
      ),
    [newCouponProductIds, products, categoryNameById],
  );
  const newCouponManualCategoryLabels = useMemo(
    () => resolveReferenceLabels(newCouponCategoryIds, categoryNameById, "Categoria"),
    [newCouponCategoryIds, categoryNameById],
  );
  const newCouponRequiredProductLabels = useMemo(
    () => resolveReferenceLabels(newCouponRequiredProductIds, productNameById, "Producto"),
    [newCouponRequiredProductIds, productNameById],
  );
  const newCouponRequiredDetectedCategoryLabels = useMemo(
    () =>
      resolveReferenceLabels(
        deriveCategoryIdsFromProducts(newCouponRequiredProductIds, products),
        categoryNameById,
        "Categoria",
      ),
    [newCouponRequiredProductIds, products, categoryNameById],
  );
  const newCouponManualRequiredCategoryLabels = useMemo(
    () => resolveReferenceLabels(newCouponRequiredCategoryIds, categoryNameById, "Categoria"),
    [newCouponRequiredCategoryIds, categoryNameById],
  );
  const newCouponCompatibleCategories = useMemo(
    () => resolveCompatibleCategories(newCouponProductIds, products, categories),
    [newCouponProductIds, products, categories],
  );
  const newCouponCompatibleRequiredCategories = useMemo(
    () => resolveCompatibleCategories(newCouponRequiredProductIds, products, categories),
    [newCouponRequiredProductIds, products, categories],
  );

  useEffect(() => {
    if (newCouponScope === "order") {
      setShowNewCouponCategoryFilters(false);
      setShowNewCouponRequiredCategoryFilters(false);
    }
    if (newCouponScope !== "bundle") {
      setShowNewCouponRequiredCategoryFilters(false);
    }
  }, [newCouponScope]);

  useEffect(() => {
    setNewCouponCategoryIds((previous) => normalizeCategoryIdsForProducts(previous, newCouponProductIds, products));
  }, [newCouponProductIds, products]);

  useEffect(() => {
    setNewCouponRequiredCategoryIds((previous) =>
      normalizeCategoryIdsForProducts(previous, newCouponRequiredProductIds, products),
    );
  }, [newCouponRequiredProductIds, products]);

  const visibleTabs = useMemo(
    () => ADMIN_TABS.filter((tab) => tab.id !== "facturacion" || canViewBilling),
    [canViewBilling],
  );

  const customerNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const customer of customers) {
      byId.set(customer.id, customer.fullName);
    }
    for (const entry of users) {
      if (!byId.has(entry.id)) {
        byId.set(entry.id, entry.fullName);
      }
    }
    return byId;
  }, [customers, users]);

  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (isAdminTab(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    if (!canViewBilling && activeTab === "facturacion") {
      setActiveTab("catalogo");
    }
  }, [activeTab, canViewBilling]);

  function handleTabChange(tab: AdminTab) {
    if (tab === activeTab && searchParams.get("tab") === tab) {
      return;
    }

    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", tab);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      router.push("/login");
      return;
    }
    if (!canAccessAdmin) {
      router.push("/mis-pedidos");
    }
  }, [authLoading, canAccessAdmin, router, user]);

  async function loadDashboard() {
    setLoading(true);
    setError(null);

    try {
      const tenantData = await resolveTenantByKey(tenantKey);
      setTenant(tenantData);
      setBillingSaveMessage(null);

      const billingSettingsRequest = canViewBilling
        ? authedRequest<BillingSettingsResponse>(`/billing/settings?tenantId=${tenantData.id}`)
        : Promise.resolve(null);

      const [
        categoriesData,
        productsData,
        couponsData,
        analyticsData,
        deliveryZonesData,
        pickupPointsData,
        ordersData,
        orderReturnsData,
        usersData,
        customersData,
        billingSettingsData,
      ] = await Promise.all([
        apiRequest<Category[]>(`/catalog/categories?tenantId=${tenantData.id}`),
        apiRequest<PaginatedProducts>(`/catalog/products?tenantId=${tenantData.id}&page=1&limit=100&isActive=true`),
        authedRequest<Coupon[]>(`/coupons?tenantId=${tenantData.id}`),
        authedRequest<AnalyticsOverview>(`/analytics/overview?tenantId=${tenantData.id}&rangeDays=30`),
        authedRequest<DeliveryZone[]>(`/delivery-zones?tenantId=${tenantData.id}&includeInactive=true`),
        authedRequest<PickupPoint[]>(`/pickup-points?tenantId=${tenantData.id}&includeInactive=true`),
        authedRequest<Order[]>(`/orders/tenant?tenantId=${tenantData.id}`),
        authedRequest<OrderReturn[]>(`/returns/tenant?tenantId=${tenantData.id}`),
        authedRequest<User[]>(`/users?tenantId=${tenantData.id}`),
        authedRequest<TenantCustomer[]>(`/users/customers?tenantId=${tenantData.id}`),
        billingSettingsRequest,
      ]);

      setCategories(categoriesData);
      setProducts(productsData.items);
      setCoupons(couponsData);
      setAnalyticsOverview(analyticsData);
      setDeliveryZones(deliveryZonesData);
      setPickupPoints(pickupPointsData);
      setOrders(ordersData);
      setOrderReturns(orderReturnsData);
      setUsers(usersData);
      setCustomers(customersData);
      setBillingSettings(billingSettingsData);
      setBillingDraft(toBillingDraft(billingSettingsData));
      setCourierDrafts((previous) => {
        const next: Record<string, { name: string; phone: string }> = {};
        for (const order of ordersData) {
          next[order.id] = {
            name: previous[order.id]?.name ?? order.assignedCourierName ?? "",
            phone: previous[order.id]?.phone ?? order.assignedCourierPhone ?? "",
          };
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el panel";
      setError(message);
      setAnalyticsOverview(null);
      setBillingSettings(null);
      setBillingDraft(createDefaultBillingDraft());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !user || !canAccessAdmin) {
      return;
    }
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canAccessAdmin, tenantKey, user]);

  function toOptionalTrimmed(value: string): string | undefined {
    const normalized = value.trim();
    return normalized.length ? normalized : undefined;
  }

  async function saveBillingSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    if (!canEditBilling) {
      setError("No tienes permisos para actualizar facturacion.");
      return;
    }

    setBusy(true);
    setError(null);
    setBillingSaveMessage(null);

    try {
      const payload: Record<string, unknown> = {
        provider: billingDraft.provider,
        environment: billingDraft.environment,
        isActive: billingDraft.isActive,
        issuerRuc: toOptionalTrimmed(billingDraft.issuerRuc),
        issuerBusinessName: toOptionalTrimmed(billingDraft.issuerBusinessName),
        issuerAddress: toOptionalTrimmed(billingDraft.issuerAddress),
        invoiceSeries: toOptionalTrimmed(billingDraft.invoiceSeries),
        receiptSeries: toOptionalTrimmed(billingDraft.receiptSeries),
        creditNoteSeries: toOptionalTrimmed(billingDraft.creditNoteSeries),
      };

      if (billingDraft.provider === "nubefact") {
        payload.apiBaseUrl = toOptionalTrimmed(billingDraft.apiBaseUrl);
        const apiToken = toOptionalTrimmed(billingDraft.apiToken);
        if (apiToken) {
          payload.apiToken = apiToken;
        }
      }

      const saved = await authedRequest<BillingSettingsResponse>(`/billing/settings?tenantId=${tenant.id}`, {
        method: "PUT",
        body: payload,
      });

      setBillingSettings(saved);
      setBillingDraft(toBillingDraft(saved));
      setBillingSaveMessage("Configuracion de facturacion guardada correctamente.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo guardar la configuracion de facturacion";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function issueBillingDocument(order: Order) {
    if (!canIssueBillingDocuments) {
      setError("No tienes permisos para emitir comprobantes.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/billing/orders/${order.id}/issue`, {
        method: "POST",
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo emitir el comprobante";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function openOrderDocumentPdf(order: Order) {
    if (!accessToken) {
      setError("Tu sesion expiro. Inicia sesion nuevamente.");
      return;
    }

    setPdfOrderIdLoading(order.id);
    setError(null);
    try {
      const link = await authedRequest<{ documentNumber: string; pdfUrl: string | null }>(
        `/billing/orders/${order.id}/documents/latest/link`,
      );
      if (link.pdfUrl) {
        window.open(link.pdfUrl, "_blank", "noopener,noreferrer");
        return;
      }

      const response = await fetch(`${API_URL}/billing/orders/${order.id}/documents/latest/pdf`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(parseApiErrorMessage(errorText, "No se pudo obtener el PDF del comprobante"));
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo abrir el comprobante";
      setError(message);
    } finally {
      setPdfOrderIdLoading(null);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authedRequest("/catalog/categories", {
        method: "POST",
        body: {
          tenantId: tenant.id,
          name: newCategoryName,
          slug: slugify(newCategoryName),
        },
      });
      setNewCategoryName("");
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear categoria";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory(categoryId: string) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/catalog/categories/${categoryId}`, {
        method: "DELETE",
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar categoria";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    const targetCategoryError = buildCategoryMismatchMessage(
      newCouponCategoryIds,
      newCouponProductIds,
      products,
      categoryNameById,
      "los productos objetivo",
    );
    if (targetCategoryError) {
      setError(targetCategoryError);
      return;
    }

    const bundleCategoryError =
      newCouponScope === "bundle"
        ? buildCategoryMismatchMessage(
            newCouponRequiredCategoryIds,
            newCouponRequiredProductIds,
            products,
            categoryNameById,
            "los productos requeridos del bundle",
          )
        : null;
    if (bundleCategoryError) {
      setError(bundleCategoryError);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rules =
        newCouponScope === "order"
          ? undefined
          : {
              minQuantity: newCouponScope === "volume" ? Number(newCouponMinQuantity || "0") : undefined,
              productIds: newCouponProductIds.length ? newCouponProductIds : undefined,
              categoryIds: newCouponCategoryIds.length ? newCouponCategoryIds : undefined,
              requiredProductIds: newCouponScope === "bundle" && newCouponRequiredProductIds.length ? newCouponRequiredProductIds : undefined,
              requiredCategoryIds:
                newCouponScope === "bundle" && newCouponRequiredCategoryIds.length ? newCouponRequiredCategoryIds : undefined,
            };

      await authedRequest("/coupons", {
        method: "POST",
        body: {
          tenantId: tenant.id,
          code: newCouponCode.toUpperCase().trim(),
          type: newCouponType,
          scope: newCouponScope,
          value: Number(newCouponValue),
          isActive: true,
          rules,
        },
      });
      setNewCouponCode("");
      setNewCouponValue("10");
      setNewCouponScope("order");
      setNewCouponMinQuantity("2");
      setNewCouponProductIds([]);
      setNewCouponCategoryIds([]);
      setNewCouponRequiredProductIds([]);
      setNewCouponRequiredCategoryIds([]);
      setShowNewCouponCategoryFilters(false);
      setShowNewCouponRequiredCategoryFilters(false);
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear cupón";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function startEditCoupon(coupon: Coupon) {
    const draft = normalizeCouponDraftCategorySelections(createCouponDraft(coupon), products);
    setEditingCouponId(coupon.id);
    setCouponDrafts((previous) => ({
      ...previous,
      [coupon.id]: draft,
    }));
    setCouponAdvancedSections((previous) => ({
      ...previous,
      [coupon.id]: {
        target: Boolean(draft.categoryIds.length),
        bundle: Boolean(draft.requiredCategoryIds.length),
      },
    }));
  }

  function updateCouponDraft(couponId: string, patch: Partial<CouponDraft>) {
    setCouponDrafts((previous) => {
      const current = previous[couponId];
      if (!current) {
        return previous;
      }

      const nextDraft = normalizeCouponDraftCategorySelections(
        {
          ...current,
          ...patch,
        },
        products,
      );

      return {
        ...previous,
        [couponId]: nextDraft,
      };
    });
  }

  function toggleCouponAdvancedSection(couponId: string, section: "target" | "bundle") {
    setCouponAdvancedSections((previous) => {
      const current = previous[couponId] ?? { target: false, bundle: false };
      return {
        ...previous,
        [couponId]: {
          ...current,
          [section]: !current[section],
        },
      };
    });
  }

  async function saveCoupon(couponId: string) {
    const draft = couponDrafts[couponId];
    if (!draft) {
      return;
    }

    const targetCategoryError = buildCategoryMismatchMessage(
      draft.categoryIds,
      draft.productIds,
      products,
      categoryNameById,
      "los productos objetivo",
    );
    if (targetCategoryError) {
      setError(targetCategoryError);
      return;
    }

    const bundleCategoryError =
      draft.scope === "bundle"
        ? buildCategoryMismatchMessage(
            draft.requiredCategoryIds,
            draft.requiredProductIds,
            products,
            categoryNameById,
            "los productos requeridos del bundle",
          )
        : null;
    if (bundleCategoryError) {
      setError(bundleCategoryError);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rules =
        draft.scope === "order"
          ? null
          : {
              minQuantity: draft.scope === "volume" ? Number(draft.minQuantity || "0") : undefined,
              productIds: draft.productIds.length ? draft.productIds : undefined,
              categoryIds: draft.categoryIds.length ? draft.categoryIds : undefined,
              requiredProductIds: draft.scope === "bundle" && draft.requiredProductIds.length ? draft.requiredProductIds : undefined,
              requiredCategoryIds: draft.scope === "bundle" && draft.requiredCategoryIds.length ? draft.requiredCategoryIds : undefined,
            };

      await authedRequest(`/coupons/${couponId}`, {
        method: "PATCH",
        body: {
          code: draft.code.trim().toUpperCase(),
          type: draft.type,
          scope: draft.scope,
          value: Number(draft.value),
          isActive: draft.isActive,
          rules,
        },
      });
      setEditingCouponId(null);
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar cupón";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCouponStatus(coupon: Coupon) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/coupons/${coupon.id}`, {
        method: "PATCH",
        body: {
          isActive: !coupon.isActive,
        },
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar el estado del cupón";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function openDeleteCouponModal(coupon: Coupon) {
    setCouponDeleteModal(coupon);
  }

  function closeDeleteCouponModal() {
    if (busy) {
      return;
    }
    setCouponDeleteModal(null);
  }

  async function deleteCoupon() {
    if (!couponDeleteModal) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/coupons/${couponDeleteModal.id}`, {
        method: "DELETE",
      });
      if (editingCouponId === couponDeleteModal.id) {
        setEditingCouponId(null);
      }
      setCouponDeleteModal(null);
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar cupón";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport(path: string, filename: string) {
    if (!accessToken) {
      setError("Necesitas una sesión activa para exportar reportes.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: "include",
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(parseApiErrorMessage(text, "No se pudo exportar el reporte"));
      }

      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo exportar el reporte");
    } finally {
      setBusy(false);
    }
  }

  function parseDeliveryDistricts(value: string): string[] {
    return value
      .split(",")
      .map((entry) => entry.trim().toUpperCase())
      .filter((entry, index, arr) => entry.length > 0 && arr.indexOf(entry) === index);
  }

  async function createDeliveryZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authedRequest("/delivery-zones", {
        method: "POST",
        body: {
          tenantId: tenant.id,
          name: newDeliveryZoneName,
          districts: parseDeliveryDistricts(newDeliveryZoneDistricts),
          fee: Number(newDeliveryZoneFee || "0"),
          minOrderAmount: Number(newDeliveryZoneMinOrder || "0"),
          freeShippingFrom: newDeliveryZoneFreeFrom.trim() ? Number(newDeliveryZoneFreeFrom) : undefined,
          etaMinutes: Number(newDeliveryZoneEtaMinutes || "180"),
          sortOrder: Number(newDeliveryZoneSortOrder || "0"),
          isActive: true,
        },
      });

      setNewDeliveryZoneName("");
      setNewDeliveryZoneDistricts("");
      setNewDeliveryZoneFee("10");
      setNewDeliveryZoneMinOrder("0");
      setNewDeliveryZoneFreeFrom("");
      setNewDeliveryZoneEtaMinutes("180");
      setNewDeliveryZoneSortOrder("0");
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear zona de delivery";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeliveryZoneStatus(zone: DeliveryZone) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/delivery-zones/${zone.id}`, {
        method: "PATCH",
        body: {
          isActive: !zone.isActive,
        },
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar zona de delivery";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDeliveryZone(zoneId: string) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/delivery-zones/${zoneId}`, {
        method: "DELETE",
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar zona de delivery";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function parsePickupWindows(value: string): string[] {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry, index, arr) => entry.length > 0 && arr.indexOf(entry) === index);
  }

  async function createPickupPoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authedRequest("/pickup-points", {
        method: "POST",
        body: {
          tenantId: tenant.id,
          name: newPickupPointName,
          address: newPickupPointAddress.trim() || undefined,
          windows: parsePickupWindows(newPickupPointWindows),
          sortOrder: Number(newPickupPointSort || "0"),
          isActive: true,
        },
      });

      setNewPickupPointName("");
      setNewPickupPointAddress("");
      setNewPickupPointWindows("");
      setNewPickupPointSort("0");
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear sede de recojo";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function nextFulfillmentStatus(order: Order): { status: FulfillmentStatus; label: string } | null {
    if (order.fulfillmentType === "delivery") {
      if (order.fulfillmentStatus === "pending" || order.fulfillmentStatus === "preparing") {
        return { status: "ready_for_dispatch", label: "Listo despacho" };
      }
      if (order.fulfillmentStatus === "ready_for_dispatch") {
        return { status: "on_the_way", label: "En ruta" };
      }
      if (order.fulfillmentStatus === "on_the_way") {
        return { status: "completed", label: "Entregado" };
      }
      return null;
    }

    if (order.fulfillmentStatus === "pending" || order.fulfillmentStatus === "preparing") {
      return { status: "ready_for_pickup", label: "Listo recojo" };
    }
    if (order.fulfillmentStatus === "ready_for_pickup") {
      return { status: "completed", label: "Entregado en tienda" };
    }
    return null;
  }

  async function updateFulfillmentStatus(order: Order, status: FulfillmentStatus) {
    const draft = courierDrafts[order.id] ?? { name: "", phone: "" };

    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/orders/${order.id}/fulfillment-status`, {
        method: "PATCH",
        body: {
          status,
          assignedCourierName: draft.name.trim() || undefined,
          assignedCourierPhone: draft.phone.trim() || undefined,
        },
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar estado de entrega";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function openReturnActionModal(entry: OrderReturn, status: ReturnActionStatus) {
    setModalError(null);
    setReturnActionModal({ entry, status });
    setModalAdminNote("");
    setModalRefundAmount("");
    setModalPickupCourierName(entry.pickupCourierName ?? "");
    setModalPickupCourierPhone(entry.pickupCourierPhone ?? "");

    const defaultScheduled = entry.pickupScheduledAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    setModalPickupScheduledAt(toLocalDateTimeInput(defaultScheduled));

    const defaultCompleted = entry.pickupCompletedAt ?? new Date().toISOString();
    setModalPickupCompletedAt(toLocalDateTimeInput(defaultCompleted));
  }

  function closeReturnActionModal() {
    if (modalSubmitting) {
      return;
    }
    setReturnActionModal(null);
    setModalError(null);
  }

  async function submitReturnActionModal() {
    if (!returnActionModal) {
      return;
    }

    const { entry, status } = returnActionModal;
    setBusy(true);
    setModalSubmitting(true);
    setModalError(null);
    setError(null);

    try {
      const adminNote = modalAdminNote.trim() || undefined;
      let refundAmount: number | undefined;
      let clientRequestId: string | undefined;
      let pickupCourierName: string | undefined;
      let pickupCourierPhone: string | undefined;
      let pickupScheduledAt: string | undefined;
      let pickupCompletedAt: string | undefined;

      if (status === "pickup_assigned") {
        const normalizedName = modalPickupCourierName.trim();
        const normalizedPhone = modalPickupCourierPhone.trim();
        const normalizedSchedule = modalPickupScheduledAt.trim();

        if (!normalizedName || !normalizedPhone || !normalizedSchedule) {
          throw new Error("Debes indicar repartidor, telefono y horario de recojo");
        }

        const scheduledDate = new Date(normalizedSchedule);
        if (Number.isNaN(scheduledDate.getTime())) {
          throw new Error("Fecha/hora de recojo invalida");
        }

        pickupCourierName = normalizedName;
        pickupCourierPhone = normalizedPhone;
        pickupScheduledAt = scheduledDate.toISOString();
      }

      if (status === "picked_up" || (status === "received" && !entry.pickupCompletedAt)) {
        const completedDate = new Date(modalPickupCompletedAt);
        if (Number.isNaN(completedDate.getTime())) {
          throw new Error("Fecha/hora de recojo completado invalida");
        }
        pickupCompletedAt = completedDate.toISOString();
      }

      if (status === "refunded") {
        const amountInput = modalRefundAmount.trim();
        if (amountInput.length) {
          const parsedAmount = Number(amountInput);
          if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            throw new Error("Monto invalido para reembolso");
          }
          refundAmount = Number(parsedAmount.toFixed(2));
        }

        clientRequestId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${entry.id}-${Date.now()}`;
      }

      await authedRequest(`/returns/${entry.id}/status`, {
        method: "PATCH",
        body: {
          status,
          adminNote,
          refundAmount,
          clientRequestId,
          pickupCourierName,
          pickupCourierPhone,
          pickupScheduledAt,
          pickupCompletedAt,
        },
      });

      await loadDashboard();
      setReturnActionModal(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "No se pudo actualizar la devolucion";
      setModalError(message);
      setError(message);
    } finally {
      setBusy(false);
      setModalSubmitting(false);
    }
  }

  function openRefundOrderModal(order: Order, mode: "full" | "partial") {
    setModalError(null);
    setRefundOrderModal({ order, mode });
    setModalRefundAmount("");
    setModalRefundReason(
      mode === "partial" ? "reembolso parcial solicitado por administrador" : "reembolso total solicitado por administrador",
    );
  }

  function closeRefundOrderModal() {
    if (modalSubmitting) {
      return;
    }
    setRefundOrderModal(null);
    setModalError(null);
  }

  async function submitRefundOrderModal() {
    if (!refundOrderModal) {
      return;
    }

    const { order, mode } = refundOrderModal;
    setBusy(true);
    setModalSubmitting(true);
    setModalError(null);
    setError(null);

    try {
      let amount: number | undefined;
      if (mode === "partial") {
        const parsedAmount = Number(modalRefundAmount.trim());
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error("Monto invalido para reembolso parcial");
        }
        amount = Number(parsedAmount.toFixed(2));
      }

      const clientRequestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${order.id}-${Date.now()}`;

      await authedRequest(`/payments/order/${order.id}/refund`, {
        method: "POST",
        body: {
          amount,
          reason: modalRefundReason.trim() || undefined,
          clientRequestId,
        },
      });

      await loadDashboard();
      setRefundOrderModal(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "No se pudo registrar el reembolso";
      setModalError(message);
      setError(message);
    } finally {
      setBusy(false);
      setModalSubmitting(false);
    }
  }

  async function togglePickupPointStatus(point: PickupPoint) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/pickup-points/${point.id}`, {
        method: "PATCH",
        body: {
          isActive: !point.isActive,
        },
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar sede";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePickupPoint(pointId: string) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/pickup-points/${pointId}`, {
        method: "DELETE",
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar sede";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(file: File): Promise<string> {
    if (!tenant) {
      throw new Error("Tenant no cargado");
    }

    const formData = new FormData();
    formData.append("tenantId", tenant.id);
    formData.append("file", file);

    const result = await authedRequest<{ url: string }>("/catalog/uploads/image", {
      method: "POST",
      formData,
    });

    return result.url;
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const hasVariants = newProductVariants.length > 0;
      const derivedMetrics = deriveProductMetricsFromVariants(newProductVariants);
      let imageUrl: string | null = null;
      if (newProductImage) {
        imageUrl = await uploadImage(newProductImage);
      }

      await authedRequest("/catalog/products", {
        method: "POST",
        body: {
          tenantId: tenant.id,
          categoryId: newProductCategoryId || undefined,
          name: newProductName,
          slug: newProductSlug.trim() || slugify(newProductName),
          description: newProductDescription.trim() || undefined,
          price: Number(hasVariants ? derivedMetrics.price : newProductPrice),
          stock: Number(hasVariants ? derivedMetrics.stock : newProductStock),
          variants: hasVariants
            ? newProductVariants.map((variant, index) => ({
                name: variant.name.trim(),
                price: Number(variant.price),
                stock: Number(variant.stock),
                sku: variant.sku.trim() || undefined,
                isActive: variant.isActive,
                sortOrder: index,
                options: parseVariantOptions(variant.optionsText),
              }))
            : undefined,
          images: imageUrl ? [{ url: imageUrl, altText: newProductName, sortOrder: 0 }] : [],
        },
      });

      setNewProductName("");
      setNewProductSlug("");
      setNewProductDescription("");
      setNewProductPrice("0");
      setNewProductStock("0");
      setNewProductCategoryId("");
      setNewProductImage(null);
      setNewProductVariants([]);
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear producto";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function startEditProduct(product: Product) {
    setEditingProductId(product.id);
    setProductDrafts((previous) => ({
      ...previous,
      [product.id]: {
        name: product.name,
        slug: product.slug,
        description: product.description ?? "",
        price: product.price,
        stock: String(product.stock),
        categoryId: product.categoryId ?? "",
        sku: product.sku ?? "",
        isActive: product.isActive,
        variants: product.variants.map((variant, index) => ({
          id: variant.id,
          name: variant.name,
          price: variant.price,
          stock: String(variant.stock),
          sku: variant.sku ?? "",
          optionsText: formatVariantOptionsText(variant.options),
          isActive: variant.isActive,
          sortOrder: variant.sortOrder ?? index,
        })),
      },
    }));
  }

  function updateProductDraft(productId: string, patch: Partial<ProductDraft>) {
    setProductDrafts((previous) => {
      const draft = previous[productId];
      if (!draft) {
        return previous;
      }

      return {
        ...previous,
        [productId]: {
          ...draft,
          ...patch,
        },
      };
    });
  }

  function addNewProductVariant() {
    setNewProductVariants((previous) => [...previous, createEmptyVariantDraft(previous.length)]);
  }

  function updateNewProductVariant(index: number, patch: Partial<ProductVariantDraft>) {
    setNewProductVariants((previous) =>
      previous.map((variant, variantIndex) =>
        variantIndex === index
          ? {
              ...variant,
              ...patch,
            }
          : variant,
      ),
    );
  }

  function removeNewProductVariant(index: number) {
    setNewProductVariants((previous) => previous.filter((_, variantIndex) => variantIndex !== index));
  }

  function addProductDraftVariant(productId: string) {
    const draft = productDrafts[productId];
    if (!draft) {
      return;
    }
    updateProductDraft(productId, {
      variants: [...draft.variants, createEmptyVariantDraft(draft.variants.length)],
    });
  }

  function updateProductDraftVariant(productId: string, index: number, patch: Partial<ProductVariantDraft>) {
    const draft = productDrafts[productId];
    if (!draft) {
      return;
    }
    updateProductDraft(productId, {
      variants: draft.variants.map((variant, variantIndex) =>
        variantIndex === index
          ? {
              ...variant,
              ...patch,
            }
          : variant,
      ),
    });
  }

  function removeProductDraftVariant(productId: string, index: number) {
    const draft = productDrafts[productId];
    if (!draft) {
      return;
    }
    updateProductDraft(productId, {
      variants: draft.variants.filter((_, variantIndex) => variantIndex !== index),
    });
  }

  async function saveProduct(productId: string) {
    const draft = productDrafts[productId];
    if (!draft) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const hasVariants = draft.variants.length > 0;
      const derivedMetrics = deriveProductMetricsFromVariants(draft.variants);
      await authedRequest(`/catalog/products/${productId}`, {
        method: "PATCH",
        body: {
          categoryId: draft.categoryId || null,
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          description: draft.description.trim() || null,
          price: Number(hasVariants ? derivedMetrics.price : draft.price),
          stock: Number(hasVariants ? derivedMetrics.stock : draft.stock),
          sku: draft.sku.trim() || null,
          isActive: draft.isActive,
          variants: hasVariants
            ? draft.variants.map((variant, index) => ({
                id: variant.id,
                name: variant.name.trim(),
                price: Number(variant.price),
                stock: Number(variant.stock),
                sku: variant.sku.trim() || undefined,
                isActive: variant.isActive,
                sortOrder: index,
                options: parseVariantOptions(variant.optionsText),
              }))
            : [],
        },
      });

      setEditingProductId(null);
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar producto";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(productId: string) {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/catalog/products/${productId}`, {
        method: "DELETE",
      });
      if (editingProductId === productId) {
        setEditingProductId(null);
      }
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar producto";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleUserStatus(targetUser: User) {
    setBusy(true);
    setError(null);

    try {
      await authedRequest(`/users/${targetUser.id}/status`, {
        method: "PATCH",
        body: {
          isActive: !targetUser.isActive,
        },
      });
      await loadDashboard();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar usuario";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!canAccessAdmin) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        <div className="mb-2 inline-flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" />
          Acceso restringido
        </div>
        Tu rol no tiene permisos para el panel de administrador.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="fade-up rounded-2xl border border-border bg-card/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Panel admin {tenant ? `- ${tenant.name}` : ""}</h1>
            <p className="text-sm text-muted-foreground">
              Gestion unificada de catalogo, ventas, logistica, facturacion y usuarios.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadDashboard()} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
            Recargar
          </Button>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card/70 p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "h-11 rounded-xl border px-3 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "border-primary/60 bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {(activeTab === "catalogo" || activeTab === "ventas" || activeTab === "logistica") ? (
      <div
        className={cn(
          "grid items-start gap-4",
          activeTab === "catalogo"
            ? "xl:grid-cols-[0.9fr_1.6fr]"
            : activeTab === "ventas"
              ? "xl:grid-cols-1"
              : "xl:grid-cols-2",
        )}
      >
        {activeTab === "catalogo" ? (
        <Card>
          <CardHeader>
            <CardTitle>Categorias</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex gap-2" onSubmit={createCategory}>
              <Input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Nombre de categoria"
                required
              />
              <Button type="submit" disabled={busy}>
                Crear
              </Button>
            </form>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {categories.map((category) => (
                <div key={category.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">{category.name}</p>
                    <p className="text-xs text-muted-foreground">{category.slug}</p>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => void deleteCategory(category.id)} disabled={busy}>
                    Eliminar
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {activeTab === "catalogo" ? (
        <Card>
          <CardHeader>
            <CardTitle>Productos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid gap-2 md:grid-cols-2 lg:grid-cols-6" onSubmit={createProduct}>
              <Input
                className="lg:col-span-2"
                value={newProductName}
                onChange={(event) => {
                  const name = event.target.value;
                  setNewProductName(name);
                  setNewProductSlug(slugify(name));
                }}
                placeholder="Nombre"
                required
              />
              <Input
                value={newProductSlug}
                onChange={(event) => setNewProductSlug(event.target.value)}
                placeholder="slug"
                required
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={newProductVariants.length > 0 ? deriveProductMetricsFromVariants(newProductVariants).price : newProductPrice}
                onChange={(event) => setNewProductPrice(event.target.value)}
                placeholder="Precio"
                required
                disabled={newProductVariants.length > 0}
              />
              <Input
                type="number"
                min={0}
                step={1}
                value={newProductVariants.length > 0 ? deriveProductMetricsFromVariants(newProductVariants).stock : newProductStock}
                onChange={(event) => setNewProductStock(event.target.value)}
                placeholder="Stock"
                required
                disabled={newProductVariants.length > 0}
              />
              <select
                className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
                value={newProductCategoryId}
                onChange={(event) => setNewProductCategoryId(event.target.value)}
              >
                <option value="">Sin categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              <textarea
                className="md:col-span-2 lg:col-span-6 min-h-24 rounded-xl border border-border bg-card px-3 py-2 text-sm"
                value={newProductDescription}
                onChange={(event) => setNewProductDescription(event.target.value)}
                placeholder="Descripcion del producto (opcional)"
              />

              <div className="md:col-span-2 lg:col-span-6 space-y-3 rounded-2xl border border-dashed border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Variantes</p>
                    <p className="text-xs text-muted-foreground">
                      Opcional. Ejemplo de atributos: Color: Azul, Talla: M
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={addNewProductVariant} disabled={busy}>
                    Agregar variante
                  </Button>
                </div>

                {newProductVariants.length > 0 ? (
                  <div className="space-y-3">
                    {newProductVariants.map((variant, index) => (
                      <div key={`new-variant-${index}`} className="grid gap-2 rounded-2xl border border-border p-3 md:grid-cols-2 lg:grid-cols-6">
                        <Input
                          className="lg:col-span-2"
                          value={variant.name}
                          onChange={(event) => updateNewProductVariant(index, { name: event.target.value })}
                          placeholder="Nombre de variante"
                        />
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={variant.price}
                          onChange={(event) => updateNewProductVariant(index, { price: event.target.value })}
                          placeholder="Precio"
                        />
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={variant.stock}
                          onChange={(event) => updateNewProductVariant(index, { stock: event.target.value })}
                          placeholder="Stock"
                        />
                        <Input
                          value={variant.sku}
                          onChange={(event) => updateNewProductVariant(index, { sku: event.target.value })}
                          placeholder="SKU"
                        />
                        <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm">
                          <input
                            type="checkbox"
                            checked={variant.isActive}
                            onChange={(event) => updateNewProductVariant(index, { isActive: event.target.checked })}
                          />
                          Activa
                        </label>
                        <Input
                          className="md:col-span-2 lg:col-span-5"
                          value={variant.optionsText}
                          onChange={(event) => updateNewProductVariant(index, { optionsText: event.target.value })}
                          placeholder="Atributos: Color: Azul, Talla: M"
                        />
                        <Button type="button" variant="danger" onClick={() => removeNewProductVariant(index)} disabled={busy}>
                          Quitar
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Si no agregas variantes, el producto se maneja con stock simple.</p>
                )}
              </div>

              <label className="lg:col-span-4 flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm">
                <Upload className="h-4 w-4" />
                <span className="text-muted-foreground">{newProductImage ? newProductImage.name : "Subir imagen"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => setNewProductImage(event.target.files?.[0] ?? null)}
                />
              </label>

              <Button className="lg:col-span-2" type="submit" disabled={busy}>
                Crear producto
              </Button>
            </form>

            <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
              {products.map((product) => (
                <div key={product.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                  {editingProductId === product.id ? (
                    <div className="w-full space-y-2">
                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                        <Input
                          value={productDrafts[product.id]?.name ?? ""}
                          onChange={(event) => updateProductDraft(product.id, { name: event.target.value })}
                          placeholder="Nombre"
                          required
                        />
                        <Input
                          value={productDrafts[product.id]?.slug ?? ""}
                          onChange={(event) => updateProductDraft(product.id, { slug: event.target.value })}
                          placeholder="Slug"
                          required
                        />
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={
                            (productDrafts[product.id]?.variants?.length ?? 0) > 0
                              ? deriveProductMetricsFromVariants(productDrafts[product.id]?.variants ?? []).price
                              : productDrafts[product.id]?.price ?? "0"
                          }
                          onChange={(event) => updateProductDraft(product.id, { price: event.target.value })}
                          placeholder="Precio"
                          required
                          disabled={(productDrafts[product.id]?.variants?.length ?? 0) > 0}
                        />
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={
                            (productDrafts[product.id]?.variants?.length ?? 0) > 0
                              ? deriveProductMetricsFromVariants(productDrafts[product.id]?.variants ?? []).stock
                              : productDrafts[product.id]?.stock ?? "0"
                          }
                          onChange={(event) => updateProductDraft(product.id, { stock: event.target.value })}
                          placeholder="Stock"
                          required
                          disabled={(productDrafts[product.id]?.variants?.length ?? 0) > 0}
                        />
                        <select
                          className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
                          value={productDrafts[product.id]?.categoryId ?? ""}
                          onChange={(event) => updateProductDraft(product.id, { categoryId: event.target.value })}
                        >
                          <option value="">Sin categoria</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                        <Input
                          value={productDrafts[product.id]?.sku ?? ""}
                          onChange={(event) => updateProductDraft(product.id, { sku: event.target.value })}
                          placeholder="SKU (opcional)"
                        />
                        <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm">
                          <input
                            type="checkbox"
                            checked={productDrafts[product.id]?.isActive ?? true}
                            onChange={(event) => updateProductDraft(product.id, { isActive: event.target.checked })}
                          />
                          Producto activo
                        </label>
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" onClick={() => void saveProduct(product.id)} disabled={busy}>
                            Guardar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setEditingProductId(null)} disabled={busy}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                      <textarea
                        className="min-h-20 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                        value={productDrafts[product.id]?.description ?? ""}
                        onChange={(event) => updateProductDraft(product.id, { description: event.target.value })}
                        placeholder="Descripcion (opcional)"
                      />
                      <div className="space-y-3 rounded-2xl border border-dashed border-border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">Variantes</p>
                            <p className="text-xs text-muted-foreground">Cada variante puede tener precio y stock propio.</p>
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => addProductDraftVariant(product.id)} disabled={busy}>
                            Agregar variante
                          </Button>
                        </div>
                        {(productDrafts[product.id]?.variants?.length ?? 0) > 0 ? (
                          <div className="space-y-3">
                            {(productDrafts[product.id]?.variants ?? []).map((variant, index) => (
                              <div key={variant.id ?? `draft-variant-${index}`} className="grid gap-2 rounded-2xl border border-border p-3 md:grid-cols-2 lg:grid-cols-6">
                                <Input
                                  className="lg:col-span-2"
                                  value={variant.name}
                                  onChange={(event) => updateProductDraftVariant(product.id, index, { name: event.target.value })}
                                  placeholder="Nombre de variante"
                                />
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={variant.price}
                                  onChange={(event) => updateProductDraftVariant(product.id, index, { price: event.target.value })}
                                  placeholder="Precio"
                                />
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={variant.stock}
                                  onChange={(event) => updateProductDraftVariant(product.id, index, { stock: event.target.value })}
                                  placeholder="Stock"
                                />
                                <Input
                                  value={variant.sku}
                                  onChange={(event) => updateProductDraftVariant(product.id, index, { sku: event.target.value })}
                                  placeholder="SKU"
                                />
                                <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={variant.isActive}
                                    onChange={(event) => updateProductDraftVariant(product.id, index, { isActive: event.target.checked })}
                                  />
                                  Activa
                                </label>
                                <Input
                                  className="md:col-span-2 lg:col-span-5"
                                  value={variant.optionsText}
                                  onChange={(event) => updateProductDraftVariant(product.id, index, { optionsText: event.target.value })}
                                  placeholder="Atributos: Color: Azul, Talla: M"
                                />
                                <Button type="button" variant="danger" size="sm" onClick={() => removeProductDraftVariant(product.id, index)} disabled={busy}>
                                  Quitar
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Producto sin variantes. Se usara el precio y stock base.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="font-medium">{product.name}</p>
                        {product.description ? <p className="text-xs text-muted-foreground">{product.description}</p> : null}
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(product.price)} | stock: {product.stock}
                        </p>
                        {product.variants.length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {product.variants.length} variantes activas
                          </p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => startEditProduct(product)} disabled={busy}>
                          Editar
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => void deleteProduct(product.id)} disabled={busy}>
                          Eliminar
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {activeTab === "ventas" ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Cupones</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Flujo principal por producto, con categorias solo como filtro avanzado cuando realmente hacen falta.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">{coupons.length} registrados</Badge>
                <Badge tone="success">{coupons.filter((coupon) => coupon.isActive).length} activos</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-4 rounded-[28px] border border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.96))] p-4 shadow-sm"
              onSubmit={createCoupon}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <Sparkles className="h-4 w-4" />
                    Constructor limpio de cupones
                  </div>
                  <p className="max-w-2xl text-sm text-muted-foreground">
                    Primero define el descuento. Luego elige productos. Las categorias aparecen como contexto automatico y solo se editan si quieres una restriccion avanzada.
                  </p>
                </div>
                <Badge tone="warning">
                  {newCouponScope === "order"
                    ? "Aplicara a todo el pedido"
                    : newCouponScope === "volume"
                      ? "Descuento por volumen"
                      : "Descuento bundle"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1 xl:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Codigo</p>
                  <Input
                    value={newCouponCode}
                    onChange={(event) => setNewCouponCode(event.target.value)}
                    placeholder="OFF10"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Tipo</p>
                  <select
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={newCouponType}
                    onChange={(event) => setNewCouponType(event.target.value as "percentage" | "fixed")}
                  >
                    <option value="percentage">Porcentaje</option>
                    <option value="fixed">Monto fijo</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Valor</p>
                  <Input
                    value={newCouponValue}
                    onChange={(event) => setNewCouponValue(event.target.value)}
                    placeholder="10"
                    type="number"
                    min={0.01}
                    step={0.01}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Alcance</p>
                <div className="grid gap-2 md:grid-cols-3">
                  {[
                    {
                      value: "order" as const,
                      label: "Pedido completo",
                      description: "El descuento cae sobre todo el carrito.",
                    },
                    {
                      value: "volume" as const,
                      label: "Volumen",
                      description: "Se activa cuando el cliente compra varias unidades.",
                    },
                    {
                      value: "bundle" as const,
                      label: "Bundle",
                      description: "Exige un conjunto de productos para activarse.",
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setNewCouponScope(option.value)}
                      className={cn(
                        "rounded-2xl border px-4 py-4 text-left transition",
                        newCouponScope === option.value
                          ? "border-amber-300 bg-amber-50 text-amber-950 shadow-sm"
                          : "border-border bg-card hover:border-amber-200 hover:bg-amber-50/50",
                      )}
                    >
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {newCouponScope === "order" ? (
                <div className="rounded-2xl border border-dashed border-amber-300 bg-white/70 p-4">
                  <p className="text-sm font-semibold text-foreground">Sin reglas adicionales</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Este cupon no se ata a productos ni categorias. Es la opcion mas simple y menos propensa a errores.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {newCouponScope === "volume" ? (
                    <div className="rounded-2xl border border-border bg-white/80 p-4">
                      <p className="text-sm font-semibold text-foreground">Condicion de volumen</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Define cuantas unidades deben sumarse para activar el descuento.
                      </p>
                      <Input
                        className="mt-3 max-w-52"
                        value={newCouponMinQuantity}
                        onChange={(event) => setNewCouponMinQuantity(event.target.value)}
                        placeholder="Min. unidades"
                        type="number"
                        min={2}
                        step={1}
                      />
                    </div>
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
                    <div className="space-y-3 rounded-2xl border border-border bg-white/85 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Productos objetivo</p>
                          <p className="text-xs text-muted-foreground">
                            Este es el flujo principal. Si eliges productos, el cupon se entiende mucho mas rapido.
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => setNewCouponProductIds([])} disabled={busy || newCouponProductIds.length === 0}>
                          Limpiar
                        </Button>
                      </div>
                      <select
                        multiple
                        className="min-h-36 w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm"
                        value={newCouponProductIds}
                        onChange={(event) => setNewCouponProductIds(readMultiSelectValues(event.target))}
                      >
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                      <SelectionBadgeList labels={newCouponProductLabels} emptyLabel="Sin productos seleccionados." />
                    </div>

                    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                      <div>
                        <p className="text-sm font-semibold text-amber-950">Categorias detectadas</p>
                        <p className="mt-1 text-xs text-amber-900/80">
                          Se leen automaticamente desde los productos elegidos. Sirven para dar contexto, no para ensuciar el flujo principal.
                        </p>
                      </div>
                      <SelectionBadgeList
                        labels={newCouponDetectedCategoryLabels}
                        emptyLabel="Aun no hay categorias detectadas porque no seleccionaste productos."
                        tone="warning"
                      />
                      <div className="rounded-2xl bg-white/80 p-3 text-xs text-muted-foreground">
                        Si necesitas restringir por categoria, activalo abajo como filtro avanzado. Si cambias de producto, las categorias fuera de rango se limpian solas.
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto justify-between rounded-2xl border border-amber-200 bg-white/70 px-3 py-3 text-left"
                        onClick={() => setShowNewCouponCategoryFilters((previous) => !previous)}
                      >
                        <span>
                          Filtro avanzado por categoria
                          {newCouponCategoryIds.length ? ` (${newCouponCategoryIds.length})` : ""}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            (showNewCouponCategoryFilters || newCouponCategoryIds.length > 0) && "rotate-180",
                          )}
                        />
                      </Button>
                    </div>
                  </div>

                  {showNewCouponCategoryFilters || newCouponCategoryIds.length > 0 ? (
                    <div className="space-y-3 rounded-2xl border border-dashed border-border bg-card/70 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Categorias objetivo</p>
                          <p className="text-xs text-muted-foreground">
                            Solo se muestran categorias compatibles con los productos elegidos. Si no hay productos, puedes usarlo como filtro legacy por categoria.
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => setNewCouponCategoryIds([])} disabled={busy || newCouponCategoryIds.length === 0}>
                          Limpiar
                        </Button>
                      </div>
                      <select
                        multiple
                        className="min-h-28 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm"
                        value={newCouponCategoryIds}
                        onChange={(event) => setNewCouponCategoryIds(readMultiSelectValues(event.target))}
                      >
                        {newCouponCompatibleCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <SelectionBadgeList labels={newCouponManualCategoryLabels} emptyLabel="Sin categorias avanzadas seleccionadas." />
                    </div>
                  ) : null}

                  {newCouponScope === "bundle" ? (
                    <div className="space-y-4 rounded-2xl border border-border bg-white/80 p-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Activadores del bundle</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Aqui defines que debe existir en el carrito para encender el descuento.
                        </p>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
                        <div className="space-y-3 rounded-2xl border border-border bg-card/80 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Productos requeridos</p>
                              <p className="text-xs text-muted-foreground">
                                El cliente debe llevar estos productos para que el cupón se active.
                              </p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => setNewCouponRequiredProductIds([])} disabled={busy || newCouponRequiredProductIds.length === 0}>
                              Limpiar
                            </Button>
                          </div>
                          <select
                            multiple
                            className="min-h-36 w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm"
                            value={newCouponRequiredProductIds}
                            onChange={(event) => setNewCouponRequiredProductIds(readMultiSelectValues(event.target))}
                          >
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>
                          <SelectionBadgeList labels={newCouponRequiredProductLabels} emptyLabel="Sin productos requeridos seleccionados." />
                        </div>

                        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                          <div>
                            <p className="text-sm font-semibold text-amber-950">Categorias detectadas del bundle</p>
                            <p className="mt-1 text-xs text-amber-900/80">
                              El sistema resume las categorias de los productos requeridos para que no mezcles condiciones sin darte cuenta.
                            </p>
                          </div>
                          <SelectionBadgeList
                            labels={newCouponRequiredDetectedCategoryLabels}
                            emptyLabel="No hay categorias detectadas porque aun no hay productos requeridos."
                            tone="warning"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto justify-between rounded-2xl border border-amber-200 bg-white/70 px-3 py-3 text-left"
                            onClick={() => setShowNewCouponRequiredCategoryFilters((previous) => !previous)}
                          >
                            <span>
                              Filtro avanzado por categoria para el bundle
                              {newCouponRequiredCategoryIds.length ? ` (${newCouponRequiredCategoryIds.length})` : ""}
                            </span>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform",
                                (showNewCouponRequiredCategoryFilters || newCouponRequiredCategoryIds.length > 0) && "rotate-180",
                              )}
                            />
                          </Button>
                        </div>
                      </div>

                      {showNewCouponRequiredCategoryFilters || newCouponRequiredCategoryIds.length > 0 ? (
                        <div className="space-y-3 rounded-2xl border border-dashed border-border bg-card/70 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Categorias requeridas</p>
                              <p className="text-xs text-muted-foreground">
                                Solo se muestran categorias compatibles con los productos requeridos. Si cambias el bundle, las incompatibles se retiran solas.
                              </p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => setNewCouponRequiredCategoryIds([])} disabled={busy || newCouponRequiredCategoryIds.length === 0}>
                              Limpiar
                            </Button>
                          </div>
                          <select
                            multiple
                            className="min-h-28 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm"
                            value={newCouponRequiredCategoryIds}
                            onChange={(event) => setNewCouponRequiredCategoryIds(readMultiSelectValues(event.target))}
                          >
                            {newCouponCompatibleRequiredCategories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                          <SelectionBadgeList labels={newCouponManualRequiredCategoryLabels} emptyLabel="Sin categorias requeridas configuradas." />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <Button className="w-full" type="submit" disabled={busy}>
                Crear cupón
              </Button>
            </form>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {coupons.map((coupon) => (
                <div key={coupon.id} className="rounded-2xl border border-border bg-card/80 p-3 text-sm shadow-sm">
                  {editingCouponId === coupon.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <Input
                          value={couponDrafts[coupon.id]?.code ?? ""}
                          onChange={(event) => updateCouponDraft(coupon.id, { code: event.target.value })}
                          placeholder="Codigo"
                        />
                        <select
                          className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
                          value={couponDrafts[coupon.id]?.type ?? "percentage"}
                          onChange={(event) => updateCouponDraft(coupon.id, { type: event.target.value as "percentage" | "fixed" })}
                        >
                          <option value="percentage">Porcentaje</option>
                          <option value="fixed">Monto fijo</option>
                        </select>
                        <select
                          className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
                          value={couponDrafts[coupon.id]?.scope ?? "order"}
                          onChange={(event) =>
                            updateCouponDraft(coupon.id, {
                              scope: event.target.value as "order" | "volume" | "bundle",
                            })
                          }
                        >
                          <option value="order">Pedido completo</option>
                          <option value="volume">Volumen</option>
                          <option value="bundle">Bundle</option>
                        </select>
                        <Input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={couponDrafts[coupon.id]?.value ?? ""}
                          onChange={(event) => updateCouponDraft(coupon.id, { value: event.target.value })}
                          placeholder="Valor"
                        />
                      </div>

                      {couponDrafts[coupon.id]?.scope === "volume" ? (
                        <Input
                          type="number"
                          min={2}
                          step={1}
                          value={couponDrafts[coupon.id]?.minQuantity ?? "2"}
                          onChange={(event) => updateCouponDraft(coupon.id, { minQuantity: event.target.value })}
                          placeholder="Cantidad minima"
                        />
                      ) : null}

                      <div className="space-y-3">
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900/80">
                          Producto primero, categoria despues. Usa categorias solo si necesitas una restriccion adicional.
                        </div>

                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-muted-foreground">Productos objetivo</p>
                            <Button type="button" variant="outline" size="sm" onClick={() => updateCouponDraft(coupon.id, { productIds: [] })} disabled={busy || !(couponDrafts[coupon.id]?.productIds.length)}>
                              Limpiar
                            </Button>
                          </div>
                          <select
                            multiple
                            className="min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                            value={couponDrafts[coupon.id]?.productIds ?? []}
                            onChange={(event) => updateCouponDraft(coupon.id, { productIds: readMultiSelectValues(event.target) })}
                          >
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>
                          <SelectionBadgeList
                            labels={resolveReferenceLabels(couponDrafts[coupon.id]?.productIds ?? [], productNameById, "Producto")}
                            emptyLabel="Sin productos seleccionados."
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Categorias objetivo</p>
                              <p className="text-[11px] text-muted-foreground">
                                Detectadas automaticamente desde los productos. Si cambias la seleccion, las categorias invalidas se limpian solas.
                              </p>
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => toggleCouponAdvancedSection(coupon.id, "target")}>
                              {couponAdvancedSections[coupon.id]?.target || (couponDrafts[coupon.id]?.categoryIds.length ?? 0) > 0 ? "Ocultar" : "Mostrar"}
                            </Button>
                          </div>
                          <SelectionBadgeList
                            labels={resolveReferenceLabels(
                              deriveCategoryIdsFromProducts(couponDrafts[coupon.id]?.productIds ?? [], products),
                              categoryNameById,
                              "Categoria",
                            )}
                            emptyLabel="Aun no hay categorias detectadas."
                            tone="warning"
                          />
                          {couponAdvancedSections[coupon.id]?.target || (couponDrafts[coupon.id]?.categoryIds.length ?? 0) > 0 ? (
                            <>
                              <div className="flex justify-end">
                                <Button type="button" variant="outline" size="sm" onClick={() => updateCouponDraft(coupon.id, { categoryIds: [] })} disabled={busy || !(couponDrafts[coupon.id]?.categoryIds.length)}>
                                  Limpiar
                                </Button>
                              </div>
                              <select
                                multiple
                                className="min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                                value={couponDrafts[coupon.id]?.categoryIds ?? []}
                                onChange={(event) => updateCouponDraft(coupon.id, { categoryIds: readMultiSelectValues(event.target) })}
                              >
                                {resolveCompatibleCategories(couponDrafts[coupon.id]?.productIds ?? [], products, categories).map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.name}
                                  </option>
                                ))}
                              </select>
                              <SelectionBadgeList
                                labels={resolveReferenceLabels(couponDrafts[coupon.id]?.categoryIds ?? [], categoryNameById, "Categoria")}
                                emptyLabel="Sin categorias avanzadas seleccionadas."
                              />
                            </>
                          ) : null}
                        </div>
                      </div>
                      </div>

                      {couponDrafts[coupon.id]?.scope === "bundle" ? (
                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-muted-foreground">Productos requeridos</p>
                              <Button type="button" variant="outline" size="sm" onClick={() => updateCouponDraft(coupon.id, { requiredProductIds: [] })} disabled={busy || !(couponDrafts[coupon.id]?.requiredProductIds.length)}>
                                Limpiar
                              </Button>
                            </div>
                            <select
                              multiple
                              className="min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                              value={couponDrafts[coupon.id]?.requiredProductIds ?? []}
                              onChange={(event) => updateCouponDraft(coupon.id, { requiredProductIds: readMultiSelectValues(event.target) })}
                            >
                              {products.map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                            </select>
                            <SelectionBadgeList
                              labels={resolveReferenceLabels(couponDrafts[coupon.id]?.requiredProductIds ?? [], productNameById, "Producto")}
                              emptyLabel="Sin productos requeridos seleccionados."
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">Categorias requeridas</p>
                                <p className="text-[11px] text-muted-foreground">
                                  Usa este filtro solo si el bundle debe cumplirse por categoria y no por producto. Las incompatibles se limpian automaticamente.
                                </p>
                              </div>
                              <Button type="button" variant="ghost" size="sm" onClick={() => toggleCouponAdvancedSection(coupon.id, "bundle")}>
                                {couponAdvancedSections[coupon.id]?.bundle || (couponDrafts[coupon.id]?.requiredCategoryIds.length ?? 0) > 0 ? "Ocultar" : "Mostrar"}
                              </Button>
                            </div>
                            <SelectionBadgeList
                              labels={resolveReferenceLabels(
                                deriveCategoryIdsFromProducts(couponDrafts[coupon.id]?.requiredProductIds ?? [], products),
                                categoryNameById,
                                "Categoria",
                              )}
                              emptyLabel="Aun no hay categorias detectadas para el bundle."
                              tone="warning"
                            />
                            {couponAdvancedSections[coupon.id]?.bundle || (couponDrafts[coupon.id]?.requiredCategoryIds.length ?? 0) > 0 ? (
                              <>
                                <div className="flex justify-end">
                                  <Button type="button" variant="outline" size="sm" onClick={() => updateCouponDraft(coupon.id, { requiredCategoryIds: [] })} disabled={busy || !(couponDrafts[coupon.id]?.requiredCategoryIds.length)}>
                                    Limpiar
                                  </Button>
                                </div>
                                <select
                                  multiple
                                  className="min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                                  value={couponDrafts[coupon.id]?.requiredCategoryIds ?? []}
                                  onChange={(event) => updateCouponDraft(coupon.id, { requiredCategoryIds: readMultiSelectValues(event.target) })}
                                >
                                  {resolveCompatibleCategories(couponDrafts[coupon.id]?.requiredProductIds ?? [], products, categories).map((category) => (
                                    <option key={category.id} value={category.id}>
                                      {category.name}
                                    </option>
                                  ))}
                                </select>
                                <SelectionBadgeList
                                  labels={resolveReferenceLabels(couponDrafts[coupon.id]?.requiredCategoryIds ?? [], categoryNameById, "Categoria")}
                                  emptyLabel="Sin categorias requeridas configuradas."
                                />
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm">
                        <input
                          type="checkbox"
                          checked={couponDrafts[coupon.id]?.isActive ?? true}
                          onChange={(event) => updateCouponDraft(coupon.id, { isActive: event.target.checked })}
                        />
                        Cupon activo
                      </label>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => void saveCoupon(coupon.id)} disabled={busy}>
                          Guardar
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingCouponId(null)} disabled={busy}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{coupon.code}</p>
                            <Badge tone="neutral">{renderScopeLabel(coupon.scope)}</Badge>
                            {coupon.rules?.categoryIds?.length || coupon.rules?.requiredCategoryIds?.length ? (
                              <Badge tone="warning">usa categorias</Badge>
                            ) : (
                              <Badge tone="success">flujo limpio</Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground">
                            {coupon.type === "percentage" ? `${coupon.value}%` : formatMoney(coupon.value)}
                          </p>
                          <p className="text-xs text-muted-foreground">{summarizeCouponRules(coupon, products, categories)}</p>
                          <p className="text-xs text-muted-foreground">
                            Usos: {coupon.usageCount}{coupon.maxUsage ? ` / ${coupon.maxUsage}` : ""}
                          </p>
                        </div>
                        <Badge tone={coupon.isActive ? "success" : "warning"}>
                          {coupon.isActive ? "activo" : "inactivo"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => startEditCoupon(coupon)} disabled={busy}>
                          Editar
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => void toggleCouponStatus(coupon)} disabled={busy}>
                          {coupon.isActive ? "Desactivar" : "Activar"}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => openDeleteCouponModal(coupon)}
                          disabled={busy || coupon.usageCount > 0}
                        >
                          Eliminar
                        </Button>
                      </div>
                      {coupon.usageCount > 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Este cupón ya tuvo usos. Puedes editarlo o desactivarlo, pero no eliminarlo.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {activeTab === "logistica" ? (
        <Card>
          <CardHeader>
            <CardTitle>Zonas delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid grid-cols-1 gap-2" onSubmit={createDeliveryZone}>
              <Input
                value={newDeliveryZoneName}
                onChange={(event) => setNewDeliveryZoneName(event.target.value)}
                placeholder="Nombre de zona"
                required
              />
              <Input
                value={newDeliveryZoneDistricts}
                onChange={(event) => setNewDeliveryZoneDistricts(event.target.value)}
                placeholder="Distritos separados por coma"
                required
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={newDeliveryZoneFee}
                onChange={(event) => setNewDeliveryZoneFee(event.target.value)}
                placeholder="Tarifa"
                required
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={newDeliveryZoneMinOrder}
                onChange={(event) => setNewDeliveryZoneMinOrder(event.target.value)}
                placeholder="Pedido minimo"
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={newDeliveryZoneFreeFrom}
                onChange={(event) => setNewDeliveryZoneFreeFrom(event.target.value)}
                placeholder="Envio gratis desde (opcional)"
              />
              <Input
                type="number"
                min={10}
                step={10}
                value={newDeliveryZoneEtaMinutes}
                onChange={(event) => setNewDeliveryZoneEtaMinutes(event.target.value)}
                placeholder="ETA minutos"
              />
              <Input
                type="number"
                value={newDeliveryZoneSortOrder}
                onChange={(event) => setNewDeliveryZoneSortOrder(event.target.value)}
                placeholder="Orden"
              />
              <Button type="submit" disabled={busy}>
                Crear zona
              </Button>
            </form>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {deliveryZones.map((zone) => (
                <div key={zone.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{zone.name}</p>
                    <Badge tone={zone.isActive ? "success" : "warning"}>
                      {zone.isActive ? "activa" : "inactiva"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{zone.districts.join(" | ")}</p>
                  <p className="text-xs text-muted-foreground">
                    tarifa {formatMoney(zone.fee)} | min {formatMoney(zone.minOrderAmount)} | ETA {zone.etaMinutes} min
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant={zone.isActive ? "outline" : "secondary"}
                      size="sm"
                      onClick={() => void toggleDeliveryZoneStatus(zone)}
                      disabled={busy}
                    >
                      {zone.isActive ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteDeliveryZone(zone.id)}
                      disabled={busy}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))}
              {deliveryZones.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay zonas delivery registradas.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {activeTab === "logistica" ? (
        <Card>
          <CardHeader>
            <CardTitle>Sedes de recojo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid grid-cols-1 gap-2" onSubmit={createPickupPoint}>
              <Input
                value={newPickupPointName}
                onChange={(event) => setNewPickupPointName(event.target.value)}
                placeholder="Nombre de sede"
                required
              />
              <Input
                value={newPickupPointAddress}
                onChange={(event) => setNewPickupPointAddress(event.target.value)}
                placeholder="Direccion (opcional)"
              />
              <Input
                value={newPickupPointWindows}
                onChange={(event) => setNewPickupPointWindows(event.target.value)}
                placeholder="Franjas separadas por coma"
              />
              <Input
                type="number"
                value={newPickupPointSort}
                onChange={(event) => setNewPickupPointSort(event.target.value)}
                placeholder="Orden"
              />
              <Button type="submit" disabled={busy}>
                Crear sede
              </Button>
            </form>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {pickupPoints.map((point) => (
                <div key={point.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{point.name}</p>
                    <Badge tone={point.isActive ? "success" : "warning"}>
                      {point.isActive ? "activa" : "inactiva"}
                    </Badge>
                  </div>
                  {point.address ? <p className="text-xs text-muted-foreground">{point.address}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {point.windows.length ? point.windows.join(" | ") : "Sin franjas definidas"}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant={point.isActive ? "outline" : "secondary"}
                      size="sm"
                      onClick={() => void togglePickupPointStatus(point)}
                      disabled={busy}
                    >
                      {point.isActive ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void deletePickupPoint(point.id)}
                      disabled={busy}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))}
              {pickupPoints.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay sedes registradas.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        ) : null}
      </div>
      ) : null}

      {activeTab === "ventas" ? (
      <div className="grid items-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Ordenes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orders.map((order) => (
              <div key={order.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">#{order.id.slice(0, 8)}</p>
                  <div className="flex gap-2">
                    <Badge tone={orderLifecycleTone(order.lifecycleStatus)}>
                      {formatOrderLifecycleStatus(order.lifecycleStatus)}
                    </Badge>
                    <Badge tone={order.paymentStatus === "paid" ? "success" : order.paymentStatus === "unpaid" ? "warning" : "neutral"}>
                      {formatPaymentStatus(order.paymentStatus)}
                    </Badge>
                    <Badge tone={fulfillmentTone(order.fulfillmentStatus)}>
                      {formatFulfillmentStatus(order.fulfillmentStatus)}
                    </Badge>
                    {order.billingDocumentStatus ? (
                      <Badge tone={billingDocumentTone(order.billingDocumentStatus)}>
                        {formatBillingDocumentStatus(order.billingDocumentStatus)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <p className="text-muted-foreground">
                  {order.items.length} items | {formatMoney(order.total, order.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Cliente: {customerNameById.get(order.userId) ?? `Usuario ${order.userId.slice(0, 8)}`}
                </p>
                {order.fulfillmentType === "delivery" ? (
                  <p className="text-xs text-muted-foreground">
                    Telefono cliente: {order.deliveryAddress?.phone ?? "No registrado"}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {order.fulfillmentType === "delivery" ? "Delivery" : "Recojo"} | envio {formatMoney(order.shippingFee, order.currency)}
                </p>
                {order.fulfillmentType === "delivery" ? (
                  <p className="text-xs text-muted-foreground">
                    Zona: {order.deliveryZoneName ?? "No definida"} | Ventana: {order.deliveryWindow ?? "Sin ventana"}
                  </p>
                ) : null}
                {order.assignedCourierName || order.assignedCourierPhone ? (
                  <p className="text-xs text-muted-foreground">
                    Repartidor: {order.assignedCourierName ?? "-"} {order.assignedCourierPhone ? `(${order.assignedCourierPhone})` : ""}
                  </p>
                ) : null}
                {order.billingDocumentStatus && order.billingDocumentStatus !== "issued" ? (
                  <p className="text-xs text-amber-700">
                    Facturacion: {order.billingDocumentMessage ?? "Revisar configuracion de facturacion."}
                  </p>
                ) : null}
                {order.billingDocumentStatus === "issued" && order.billingDocumentNumber ? (
                  <p className="text-xs text-muted-foreground">Comprobante: {order.billingDocumentNumber}</p>
                ) : null}
                <div className="mt-2 space-y-1 rounded-lg border border-border/70 bg-muted/30 p-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                      <p className="text-foreground">
                        {item.productName} x {item.quantity}
                      </p>
                      <p className="font-medium">{formatMoney(item.lineTotal, order.currency)}</p>
                    </div>
                  ))}
                </div>
                {order.paymentStatus === "paid" ||
                order.paymentStatus === "partially_refunded" ||
                order.paymentStatus === "refunded" ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {order.billingDocumentStatus === "issued" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || pdfOrderIdLoading === order.id}
                          onClick={() => void openOrderDocumentPdf(order)}
                        >
                          {pdfOrderIdLoading === order.id ? "Abriendo PDF..." : "Ver comprobante PDF"}
                        </Button>
                      ) : null}
                      {canIssueBillingDocuments && order.billingDocumentStatus !== "issued" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy || order.status !== "paid"}
                          onClick={() => void issueBillingDocument(order)}
                        >
                          Emitir comprobante
                        </Button>
                      ) : null}
                      {order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => openRefundOrderModal(order, "partial")}
                          >
                            Reembolso parcial
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => openRefundOrderModal(order, "full")}
                          >
                            Reembolso total
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {order.fulfillmentType === "delivery" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={courierDrafts[order.id]?.name ?? ""}
                          onChange={(event) =>
                            setCourierDrafts((previous) => ({
                              ...previous,
                              [order.id]: {
                                name: event.target.value,
                                phone: previous[order.id]?.phone ?? "",
                              },
                            }))
                          }
                          placeholder="Nombre repartidor"
                        />
                        <Input
                          value={courierDrafts[order.id]?.phone ?? ""}
                          onChange={(event) =>
                            setCourierDrafts((previous) => ({
                              ...previous,
                              [order.id]: {
                                name: previous[order.id]?.name ?? "",
                                phone: event.target.value,
                              },
                            }))
                          }
                          placeholder="Telefono repartidor"
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void updateFulfillmentStatus(order, order.fulfillmentStatus)}
                      >
                        Guardar datos
                      </Button>
                      {nextFulfillmentStatus(order) ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void updateFulfillmentStatus(order, nextFulfillmentStatus(order)!.status)}
                        >
                          {nextFulfillmentStatus(order)!.label}
                        </Button>
                      ) : null}
                      {order.fulfillmentStatus !== "completed" && order.fulfillmentStatus !== "failed" ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => void updateFulfillmentStatus(order, "failed")}
                        >
                          Marcar fallido
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devoluciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orderReturns.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">Orden #{entry.orderId.slice(0, 8)}</p>
                  <Badge
                    tone={
                      entry.status === "rejected"
                        ? "warning"
                        : entry.status === "refunded" || entry.status === "received"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {formatReturnStatus(entry.status)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Motivo: {entry.reason}</p>
                <p className="text-xs text-muted-foreground">
                  Monto solicitado: {entry.requestedAmount ? formatMoney(entry.requestedAmount, entry.currency) : "No especificado"}
                </p>
                {entry.adminNote ? <p className="text-xs text-muted-foreground">Nota admin: {entry.adminNote}</p> : null}
                {entry.pickupCourierName || entry.pickupCourierPhone ? (
                  <p className="text-xs text-muted-foreground">
                    Repartidor recojo: {entry.pickupCourierName ?? "-"} {entry.pickupCourierPhone ? `(${entry.pickupCourierPhone})` : ""}
                  </p>
                ) : null}
                {entry.pickupScheduledAt ? (
                  <p className="text-xs text-muted-foreground">Recojo programado: {new Date(entry.pickupScheduledAt).toLocaleString()}</p>
                ) : null}
                {entry.pickupCompletedAt ? (
                  <p className="text-xs text-muted-foreground">Recojo completado: {new Date(entry.pickupCompletedAt).toLocaleString()}</p>
                ) : null}
                {entry.refundAmount ? (
                  <p className="text-xs text-muted-foreground">
                    Monto reembolsado: {formatMoney(entry.refundAmount, entry.currency)}
                  </p>
                ) : null}

                {entry.status === "requested" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "approved")}>
                      Aprobar
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "rejected")}>
                      Rechazar
                    </Button>
                  </div>
                ) : null}

                {entry.status === "approved" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "pickup_pending")}>
                      Iniciar recojo
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "rejected")}>
                      Rechazar
                    </Button>
                  </div>
                ) : null}

                {entry.status === "pickup_pending" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "pickup_assigned")}>
                      Asignar recojo
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "received")}>
                      Marcar recibido
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "rejected")}>
                      Rechazar
                    </Button>
                  </div>
                ) : null}

                {entry.status === "pickup_assigned" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "picked_up")}>
                      Marcar recogido
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "pickup_pending")}>
                      Volver a pendiente
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "rejected")}>
                      Rechazar
                    </Button>
                  </div>
                ) : null}

                {entry.status === "picked_up" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "received")}>
                      Confirmar recibido
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "rejected")}>
                      Rechazar
                    </Button>
                  </div>
                ) : null}

                {entry.status === "received" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => openReturnActionModal(entry, "refunded")}>
                      Reembolsar ahora
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            {orderReturns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hay devoluciones registradas.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      ) : null}

      {activeTab === "crecimiento" ? (
      <div className="space-y-4">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="space-y-1 pt-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Ingresos</p>
              <p className="text-2xl font-semibold">{formatMoney(analyticsOverview?.revenue ?? "0")}</p>
              <p className="text-xs text-muted-foreground">Ultimos {analyticsOverview?.rangeDays ?? 30} dias</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 pt-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AOV</p>
              <p className="text-2xl font-semibold">{formatMoney(analyticsOverview?.averageOrderValue ?? "0")}</p>
              <p className="text-xs text-muted-foreground">{analyticsOverview?.paidOrders ?? 0} ordenes pagadas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 pt-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Conversion checkout</p>
              <p className="text-2xl font-semibold">{(analyticsOverview?.checkoutConversionRate ?? 0).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{analyticsOverview?.totalOrders ?? 0} ordenes creadas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 pt-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Pedidos con descuento</p>
              <p className="text-2xl font-semibold">{(analyticsOverview?.discountCaptureRate ?? 0).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">{analyticsOverview?.activeCustomers ?? 0} clientes activos</p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="inline-flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Ventas por dia
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void downloadReport(`/analytics/exports/orders.csv?tenantId=${tenant?.id}`, "orders-report.csv")} disabled={busy}>
                    <Download className="h-4 w-4" />
                    Ordenes CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void downloadReport(`/analytics/exports/products.csv?tenantId=${tenant?.id}`, "products-report.csv")} disabled={busy}>
                    <Download className="h-4 w-4" />
                    Productos CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {(analyticsOverview?.salesByDay ?? []).length > 0 ? (
                (analyticsOverview?.salesByDay ?? []).map((entry) => {
                  const maxRevenue = Math.max(...(analyticsOverview?.salesByDay ?? [{ revenue: "1", day: "", ordersCount: 0 }]).map((item) => Number(item.revenue)));
                  const width = maxRevenue > 0 ? (Number(entry.revenue) / maxRevenue) * 100 : 0;
                  return (
                    <div key={entry.day} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{entry.day}</span>
                        <span>{formatMoney(entry.revenue)} | {entry.ordersCount} ordenes</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Todavia no hay ventas pagadas en el rango actual.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top productos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(analyticsOverview?.topProducts ?? []).length > 0 ? (
                (analyticsOverview?.topProducts ?? []).map((entry) => (
                  <div key={entry.productId} className="rounded-xl border border-border p-3 text-sm">
                    <p className="font-medium">{entry.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.unitsSold} uds | {entry.ordersCount} ordenes | {formatMoney(entry.revenue)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Sin productos vendidos todavia.</p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
      ) : null}

      {activeTab === "facturacion" ? (
      <div className="grid items-start gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Configuracion de facturacion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={saveBillingSettings}>
              <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={billingDraft.isActive}
                  onChange={(event) => setBillingDraft((previous) => ({ ...previous, isActive: event.target.checked }))}
                  disabled={!canEditBilling || busy}
                />
                Activar facturacion para esta tienda
              </label>

              <select
                className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
                value={billingDraft.provider}
                onChange={(event) => {
                  const nextProvider = event.target.value as BillingDraft["provider"];
                  setBillingDraft((previous) => {
                    const shouldSuggestNubefactSeries =
                      nextProvider === "nubefact" &&
                      previous.environment === "demo" &&
                      (previous.invoiceSeries.trim().toUpperCase() === "F001" ||
                        previous.invoiceSeries.trim().length === 0) &&
                      (previous.receiptSeries.trim().toUpperCase() === "B001" ||
                        previous.receiptSeries.trim().length === 0);

                    return {
                      ...previous,
                      provider: nextProvider,
                      invoiceSeries: shouldSuggestNubefactSeries ? "FFF1" : previous.invoiceSeries,
                      receiptSeries: shouldSuggestNubefactSeries ? "BBB1" : previous.receiptSeries,
                    };
                  });
                }}
                disabled={!canEditBilling || busy}
              >
                <option value="demo">Demo (pruebas)</option>
                <option value="nubefact">Nubefact</option>
              </select>

              <select
                className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
                value={billingDraft.environment}
                onChange={(event) => {
                  const nextEnvironment = event.target.value as BillingDraft["environment"];
                  setBillingDraft((previous) => {
                    const shouldSuggestNubefactSeries =
                      previous.provider === "nubefact" &&
                      nextEnvironment === "demo" &&
                      (previous.invoiceSeries.trim().toUpperCase() === "F001" ||
                        previous.invoiceSeries.trim().length === 0) &&
                      (previous.receiptSeries.trim().toUpperCase() === "B001" ||
                        previous.receiptSeries.trim().length === 0);

                    return {
                      ...previous,
                      environment: nextEnvironment,
                      invoiceSeries: shouldSuggestNubefactSeries ? "FFF1" : previous.invoiceSeries,
                      receiptSeries: shouldSuggestNubefactSeries ? "BBB1" : previous.receiptSeries,
                    };
                  });
                }}
                disabled={!canEditBilling || busy}
              >
                <option value="demo">Demo</option>
                <option value="production">Produccion</option>
              </select>

              <Input
                value={billingDraft.issuerRuc}
                onChange={(event) => setBillingDraft((previous) => ({ ...previous, issuerRuc: event.target.value }))}
                placeholder="RUC emisor (11 digitos)"
                disabled={!canEditBilling || busy}
              />
              <Input
                value={billingDraft.issuerBusinessName}
                onChange={(event) =>
                  setBillingDraft((previous) => ({ ...previous, issuerBusinessName: event.target.value }))
                }
                placeholder="Razon social"
                disabled={!canEditBilling || busy}
              />
              <Input
                className="md:col-span-2"
                value={billingDraft.issuerAddress}
                onChange={(event) =>
                  setBillingDraft((previous) => ({ ...previous, issuerAddress: event.target.value }))
                }
                placeholder="Direccion fiscal"
                disabled={!canEditBilling || busy}
              />

              <Input
                value={billingDraft.invoiceSeries}
                onChange={(event) =>
                  setBillingDraft((previous) => ({ ...previous, invoiceSeries: event.target.value.toUpperCase() }))
                }
                placeholder="Serie factura (F001)"
                disabled={!canEditBilling || busy}
              />
              <Input
                value={billingDraft.receiptSeries}
                onChange={(event) =>
                  setBillingDraft((previous) => ({ ...previous, receiptSeries: event.target.value.toUpperCase() }))
                }
                placeholder="Serie boleta (B001)"
                disabled={!canEditBilling || busy}
              />
              <Input
                value={billingDraft.creditNoteSeries}
                onChange={(event) =>
                  setBillingDraft((previous) => ({ ...previous, creditNoteSeries: event.target.value.toUpperCase() }))
                }
                placeholder="Serie nota credito (FC01)"
                disabled={!canEditBilling || busy}
              />

              {billingDraft.provider === "nubefact" ? (
                <>
                  <Input
                    className="md:col-span-2"
                    value={billingDraft.apiBaseUrl}
                    onChange={(event) =>
                      setBillingDraft((previous) => ({ ...previous, apiBaseUrl: event.target.value }))
                    }
                    placeholder="API Base URL Nubefact"
                    disabled={!canEditBilling || busy}
                  />
                  <Input
                    className="md:col-span-2"
                    value={billingDraft.apiToken}
                    onChange={(event) =>
                      setBillingDraft((previous) => ({ ...previous, apiToken: event.target.value }))
                    }
                    placeholder={
                      billingSettings?.apiTokenConfigured
                        ? "API Token (dejar vacio para mantener el actual)"
                        : "API Token Nubefact"
                    }
                    disabled={!canEditBilling || busy}
                  />
                </>
              ) : null}

              <Button className="md:col-span-2" type="submit" disabled={!canEditBilling || busy}>
                Guardar configuracion
              </Button>
            </form>

            {!canEditBilling ? (
              <p className="text-xs text-muted-foreground">
                Tu rol puede consultar facturacion, pero no editar la configuracion.
              </p>
            ) : null}
            {billingSaveMessage ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {billingSaveMessage}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado actual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Configurada</span>
                <Badge tone={billingSettings?.configured ? "success" : "warning"}>
                  {billingSettings?.configured ? "si" : "no"}
                </Badge>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Activa</span>
                <Badge tone={billingSettings?.isActive ? "success" : "warning"}>
                  {billingSettings?.isActive ? "si" : "no"}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Proveedor: {billingSettings?.provider ?? "demo"} | Entorno: {billingSettings?.environment ?? "demo"}
              </p>
              <p className="text-xs text-muted-foreground">
                Token API: {billingSettings?.apiTokenConfigured ? "configurado" : "no configurado"}
              </p>
              {billingSettings?.updatedAt ? (
                <p className="text-xs text-muted-foreground">
                  Ultima actualizacion: {new Date(billingSettings.updatedAt).toLocaleString()}
                </p>
              ) : null}
            </div>

            <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
              1. Activa facturacion y guarda.
              <br />
              2. Nuevos pagos emitiran boleta/factura automaticamente.
              <br />
              3. Para pedidos anteriores, usa "Emitir comprobante" en la pestaña Ventas.
            </div>
          </CardContent>
        </Card>
      </div>
      ) : null}

      {activeTab === "usuarios" ? (
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usuarios del tenant</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {users.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">{entry.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.email} | {entry.role}
                  </p>
                </div>
                <Button
                  variant={entry.isActive ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => void toggleUserStatus(entry)}
                  disabled={busy || entry.id === user?.id}
                >
                  {entry.isActive ? "Desactivar" : "Activar"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clientes de la tienda</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aun no hay clientes con actividad en esta tienda.</p>
            ) : (
              customers.map((customer) => (
                <div key={customer.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{customer.fullName}</p>
                    <Badge tone={customer.isActive ? "success" : "warning"}>
                      {customer.isActive ? "activo" : "inactivo"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{customer.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Pedidos: {customer.ordersCount} | Total: {formatMoney(customer.totalSpent)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      ) : null}

      <ReturnActionModal
        modal={returnActionModal}
        submitting={modalSubmitting}
        error={modalError}
        adminNote={modalAdminNote}
        refundAmount={modalRefundAmount}
        pickupCourierName={modalPickupCourierName}
        pickupCourierPhone={modalPickupCourierPhone}
        pickupScheduledAt={modalPickupScheduledAt}
        pickupCompletedAt={modalPickupCompletedAt}
        onAdminNoteChange={setModalAdminNote}
        onRefundAmountChange={setModalRefundAmount}
        onPickupCourierNameChange={setModalPickupCourierName}
        onPickupCourierPhoneChange={setModalPickupCourierPhone}
        onPickupScheduledAtChange={setModalPickupScheduledAt}
        onPickupCompletedAtChange={setModalPickupCompletedAt}
        onClose={closeReturnActionModal}
        onSubmit={() => void submitReturnActionModal()}
      />

      <OrderRefundModal
        modal={refundOrderModal}
        submitting={modalSubmitting}
        error={modalError}
        refundReason={modalRefundReason}
        refundAmount={modalRefundAmount}
        onRefundReasonChange={setModalRefundReason}
        onRefundAmountChange={setModalRefundAmount}
        onClose={closeRefundOrderModal}
        onSubmit={() => void submitRefundOrderModal()}
      />

      <Modal open={Boolean(couponDeleteModal)} onClose={closeDeleteCouponModal} contentClassName="max-w-md">
        {couponDeleteModal ? (
          <>
            <h2 className="text-lg font-semibold">Eliminar cupón</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Vas a eliminar el cupón <span className="font-medium text-foreground">{couponDeleteModal.code}</span>.
              Esta acción no se puede deshacer.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={closeDeleteCouponModal}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void deleteCoupon()}>
                {busy ? "Eliminando..." : "Eliminar cupón"}
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

