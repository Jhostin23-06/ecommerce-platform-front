export type UserRole =
  | "platform_superadmin"
  | "tenant_admin"
  | "catalog_manager"
  | "order_manager"
  | "support"
  | "customer";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TenantCustomer = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  ordersCount: number;
  totalSpent: string;
  lastOrderAt: string | null;
};

export type Category = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductImage = {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
};

export type ProductVariantOption = {
  name: string;
  value: string;
};

export type ProductVariant = {
  id: string;
  productId: string;
  name: string;
  slug: string;
  sku: string | null;
  price: string;
  stock: number;
  reservedStock: number;
  options: ProductVariantOption[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Product = {
  id: string;
  tenantId: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  stock: number;
  reservedStock: number;
  sku: string | null;
  isActive: boolean;
  category?: Category | null;
  images: ProductImage[];
  variants: ProductVariant[];
  hasVariants?: boolean;
  priceFrom?: string;
  priceTo?: string;
  averageRating?: number;
  reviewCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CartItem = {
  id: string;
  cartId: string;
  productId: string;
  productVariantId: string | null;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  productImageUrlSnapshot: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
};

export type Cart = {
  id: string;
  tenantId: string;
  userId: string;
  status: "active" | "ordered" | "abandoned";
  currency: string;
  subtotal: string;
  discountTotal: string;
  total: string;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
};

export type Coupon = {
  id: string;
  tenantId: string;
  code: string;
  type: "percentage" | "fixed";
  scope: "order" | "volume" | "bundle";
  value: string;
  rules: {
    minQuantity?: number | null;
    productIds?: string[];
    categoryIds?: string[];
    requiredProductIds?: string[];
    requiredCategoryIds?: string[];
  } | null;
  usageCount: number;
  maxUsage: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  productVariantId: string | null;
  productName: string;
  sku: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
};

export type FulfillmentType = "delivery" | "pickup";

export type DeliveryAddress = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  district: string;
  city: string;
  reference?: string | null;
};

export type PickupDetails = {
  pointId: string;
  pointName: string;
  pointAddress?: string | null;
  windowLabel: string;
  scheduledAt?: string | null;
};

export type PickupPoint = {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  windows: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryZone = {
  id: string;
  tenantId: string;
  name: string;
  districts: string[];
  fee: string;
  minOrderAmount: string;
  freeShippingFrom: string | null;
  etaMinutes: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FulfillmentStatus =
  | "pending"
  | "preparing"
  | "ready_for_dispatch"
  | "on_the_way"
  | "ready_for_pickup"
  | "completed"
  | "failed";

export type OrderLifecycleStatus =
  | "pending"
  | "paid"
  | "preparing"
  | "shipped"
  | "delivered"
  | "cancelled";

export type OrderStatusHistoryEntry = {
  id: string;
  orderId: string;
  previousStatus: OrderLifecycleStatus | null;
  nextStatus: OrderLifecycleStatus;
  source: string;
  note: string | null;
  changedByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type Order = {
  id: string;
  tenantId: string;
  userId: string;
  status: "pending_payment" | "paid" | "cancelled";
  lifecycleStatus: OrderLifecycleStatus;
  paymentStatus: string;
  paymentProvider: string | null;
  paymentReference: string | null;
  couponCode: string | null;
  fulfillmentType: FulfillmentType;
  fulfillmentStatus: FulfillmentStatus;
  deliveryAddress: DeliveryAddress | null;
  pickupDetails: PickupDetails | null;
  deliveryZoneId: string | null;
  deliveryZoneName: string | null;
  deliveryWindow: string | null;
  assignedCourierName: string | null;
  assignedCourierPhone: string | null;
  fulfillmentNotes: string | null;
  shippingFee: string;
  estimatedFulfillmentAt: string | null;
  subtotal: string;
  discountTotal: string;
  total: string;
  currency: string;
  billingDocumentStatus: "issued" | "failed" | "missing_configuration" | "pending" | null;
  billingDocumentMessage: string | null;
  billingDocumentNumber: string | null;
  items: OrderItem[];
  statusHistory: OrderStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
};

export type OrderReturnStatus =
  | "requested"
  | "approved"
  | "pickup_pending"
  | "pickup_assigned"
  | "picked_up"
  | "received"
  | "rejected"
  | "refunded";

export type OrderReturn = {
  id: string;
  orderId: string;
  tenantId: string;
  userId: string;
  status: OrderReturnStatus;
  reason: string;
  adminNote: string | null;
  requestedAmount: string | null;
  refundAmount: string | null;
  currency: string;
  refundReference: string | null;
  pickupCourierName: string | null;
  pickupCourierPhone: string | null;
  pickupScheduledAt: string | null;
  pickupCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedProducts = {
  items: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type ProductReview = {
  id: string;
  tenantId: string;
  productId: string;
  userId: string;
  rating: number;
  title: string | null;
  comment: string | null;
  isVerifiedPurchase: boolean;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductReviewsResponse = {
  items: ProductReview[];
  averageRating: number;
  reviewCount: number;
};

export type WishlistResponse = {
  items: Product[];
  productIds: string[];
};

export type AnalyticsOverview = {
  rangeDays: number;
  revenue: string;
  totalOrders: number;
  paidOrders: number;
  averageOrderValue: string;
  checkoutConversionRate: number;
  discountCaptureRate: number;
  activeCustomers: number;
  recentCustomers: Array<{
    id: string;
    fullName: string;
    email: string;
  }>;
  salesByDay: Array<{
    day: string;
    ordersCount: number;
    revenue: string;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    ordersCount: number;
    unitsSold: number;
    revenue: string;
  }>;
  lifecycleBreakdown: Array<{
    status: string;
    count: number;
  }>;
};
