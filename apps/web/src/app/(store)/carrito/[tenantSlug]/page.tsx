"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { ApiError, resolveTenantByKey } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { cartChanged, notify } from "@/lib/ui-events";
import { formatMoney } from "@/lib/utils";
import type { Cart, DeliveryZone, FulfillmentType, PickupPoint, Tenant } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CouponRuleReference = {
  id: string;
  label: string;
};

type CouponEvaluationPreview = {
  code: string;
  eligible: boolean;
  discountAmount: string;
  feedback: {
    scope: "order" | "volume" | "bundle";
    title: string;
    message: string;
    matchedQuantity?: number;
    requiredQuantity?: number;
    missingQuantity?: number;
    targetProducts?: CouponRuleReference[];
    targetCategories?: CouponRuleReference[];
    requiredProducts?: CouponRuleReference[];
    requiredCategories?: CouponRuleReference[];
    matchedProducts?: CouponRuleReference[];
    matchedCategories?: CouponRuleReference[];
    missingProducts?: CouponRuleReference[];
    missingCategories?: CouponRuleReference[];
  };
};

type CheckoutPreview = {
  subtotal: string;
  discountTotal: string;
  shippingFee: string;
  total: string;
  currency: string;
  couponCode: string | null;
  fulfillmentType: FulfillmentType;
  estimatedFulfillmentAt: string | null;
  deliveryZoneName: string | null;
  deliveryWindow: string | null;
  couponEvaluation: CouponEvaluationPreview | null;
};

function formatCouponReferences(items?: CouponRuleReference[]) {
  if (!items?.length) {
    return null;
  }
  return items.map((item) => item.label).join(", ");
}

function getCouponCustomerTitle(couponEvaluation: CouponEvaluationPreview) {
  if (couponEvaluation.eligible) {
    return "Descuento válido";
  }

  if (couponEvaluation.feedback.scope === "bundle") {
    return "Agrega lo que falta";
  }

  return couponEvaluation.feedback.title;
}

function getCouponCustomerMessage(couponEvaluation: CouponEvaluationPreview) {
  if (couponEvaluation.feedback.scope !== "bundle") {
    return couponEvaluation.feedback.message;
  }

  if (couponEvaluation.eligible) {
    return "Descuento válido.";
  }

  return "Agrega los productos o categorías faltantes para activar el descuento.";
}

type BillingDocumentType = "receipt" | "invoice";

export default function CartPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const { authedRequest, user, loading: authLoading } = useAuth();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("delivery");
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliveryWindow, setDeliveryWindow] = useState("Hoy 2pm - 6pm");
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [deliveryAddress, setDeliveryAddress] = useState({
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    district: "",
    city: "",
    reference: "",
  });
  const [pickupDetails, setPickupDetails] = useState({
    pickupPointId: "",
    windowLabel: "",
  });
  const [billingDetails, setBillingDetails] = useState({
    documentType: "receipt" as BillingDocumentType,
    customerDocumentType: "DNI",
    customerDocumentNumber: "",
    customerName: "",
    customerEmail: "",
    customerAddress: "",
  });
  const [fulfillmentNotes, setFulfillmentNotes] = useState("");
  const [checkoutPreview, setCheckoutPreview] = useState<CheckoutPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenantKey = decodeURIComponent(params.tenantSlug);

  const fallbackShippingFee = fulfillmentType === "delivery" ? "10.00" : "0.00";
  const deliveryDistrictOptions = useMemo(() => {
    const values = new Set<string>();
    for (const zone of deliveryZones) {
      for (const district of zone.districts) {
        values.add(district);
      }
    }
    return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
  }, [deliveryZones]);
  const selectedDeliveryZone =
    checkoutPreview?.deliveryZoneName ??
    deliveryZones.find((zone) =>
      zone.districts.some(
        (district) => district.toLowerCase() === deliveryAddress.district.trim().toLowerCase(),
      ),
    )?.name ??
    null;
  const selectedPickupPoint = pickupPoints.find((point) => point.id === pickupDetails.pickupPointId) ?? null;
  const pickupWindows = selectedPickupPoint?.windows ?? [];
  const checkoutBlockedForPickup = fulfillmentType === "pickup" && (!selectedPickupPoint || !pickupDetails.windowLabel);
  const couponEvaluation = checkoutPreview?.couponEvaluation ?? null;

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      router.push("/login");
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user?.fullName) {
      return;
    }

    setDeliveryAddress((previous) => {
      if (previous.fullName.trim().length) {
        return previous;
      }
      return {
        ...previous,
        fullName: user.fullName,
      };
    });

    setBillingDetails((previous) => {
      if (previous.customerName.trim().length) {
        return previous;
      }
      return {
        ...previous,
        customerName: user.fullName,
      };
    });
  }, [user?.fullName]);

  useEffect(() => {
    if (!pickupPoints.length) {
      setPickupDetails((previous) => ({
        ...previous,
        pickupPointId: "",
        windowLabel: "",
      }));
      return;
    }

    const selectedPoint = pickupPoints.find((point) => point.id === pickupDetails.pickupPointId) ?? pickupPoints[0];
    const firstWindow = selectedPoint.windows[0] ?? "Recojo coordinado";
    const selectedWindow = selectedPoint.windows.includes(pickupDetails.windowLabel)
      ? pickupDetails.windowLabel
      : firstWindow;

    if (selectedPoint.id === pickupDetails.pickupPointId && selectedWindow === pickupDetails.windowLabel) {
      return;
    }

    setPickupDetails((previous) => ({
      ...previous,
      pickupPointId: selectedPoint.id,
      windowLabel: selectedWindow,
    }));
  }, [pickupDetails.pickupPointId, pickupDetails.windowLabel, pickupPoints]);

  async function loadCart() {
    setLoading(true);
    setError(null);
    try {
      const tenantData = await resolveTenantByKey(tenantKey);
      setTenant(tenantData);

      const [cartData, pickupPointsData, deliveryZonesData] = await Promise.all([
        authedRequest<Cart>(`/cart/me?tenantId=${tenantData.id}`),
        authedRequest<PickupPoint[]>(`/pickup-points?tenantId=${tenantData.id}`),
        authedRequest<DeliveryZone[]>(`/delivery-zones?tenantId=${tenantData.id}`),
      ]);
      setCart(cartData);
      setPickupPoints(pickupPointsData);
      setDeliveryZones(deliveryZonesData);
      const itemsCount = cartData.items.reduce((total, item) => total + item.quantity, 0);
      cartChanged({ itemsCount });
      setCheckoutPreview(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el carrito";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      return;
    }
    void loadCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, tenantKey, user]);

  useEffect(() => {
    if (!cart || !tenant) {
      return;
    }

    const normalizedCode = couponCode.trim().toUpperCase();

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setValidatingCoupon(true);
      setCouponError(null);

      try {
        const normalizedDistrict = deliveryAddress.district.trim();
        const previewBody: Record<string, unknown> = {
          tenantId: tenant.id,
          couponCode: normalizedCode || undefined,
          fulfillmentType,
        };

        if (fulfillmentType === "delivery" && normalizedDistrict) {
          previewBody.deliveryDistrict = normalizedDistrict;
          previewBody.deliveryWindow = deliveryWindow.trim() || undefined;
        }

        const preview = await authedRequest<CheckoutPreview>("/orders/preview", {
          method: "POST",
          body: previewBody,
        });

        if (cancelled) {
          return;
        }

        setCheckoutPreview(preview);
        if (!normalizedCode) {
          setCouponMessage(null);
          return;
        }

        if (!preview.couponEvaluation) {
          const hasDiscount = Number(preview.discountTotal) > 0;
          setCouponMessage(
            hasDiscount ? `Cupón ${preview.couponCode ?? normalizedCode} aplicado.` : "Cupón válido, pero no aplica descuento con el subtotal actual.",
          );
          return;
        }

        setCouponMessage(getCouponCustomerMessage(preview.couponEvaluation));
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (normalizedCode) {
          setCheckoutPreview(null);
          setCouponMessage(null);
        }
        const message = err instanceof ApiError ? err.message : "No se pudo validar el cupón";
        setCouponError(message);
      } finally {
        if (!cancelled) {
          setValidatingCoupon(false);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [authedRequest, couponCode, cart?.id, cart?.updatedAt, deliveryAddress.district, deliveryWindow, fulfillmentType, tenant]);

  async function updateItem(itemId: string, quantity: number) {
    if (quantity < 1) {
      return;
    }
    if (!tenant) {
      return;
    }

    try {
      const updatedCart = await authedRequest<Cart>(`/cart/items/${itemId}?tenantId=${tenant.id}`, {
        method: "PATCH",
        body: { quantity },
      });
      setCart(updatedCart);
      const itemsCount = updatedCart.items.reduce((total, item) => total + item.quantity, 0);
      cartChanged({ itemsCount });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar el item";
      setError(message);
    }
  }

  async function removeItem(itemId: string) {
    if (!tenant) {
      return;
    }

    try {
      const updatedCart = await authedRequest<Cart>(`/cart/items/${itemId}?tenantId=${tenant.id}`, {
        method: "DELETE",
      });
      setCart(updatedCart);
      const itemsCount = updatedCart.items.reduce((total, item) => total + item.quantity, 0);
      cartChanged({ itemsCount });
      notify({
        tone: "info",
        title: "Producto eliminado",
        description: "Se actualizo tu carrito.",
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo quitar el item";
      setError(message);
    }
  }

  function normalize(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  function buildCheckoutBody(tenantId: string) {
    const billingPayload = {
      documentType: billingDetails.documentType,
      customerDocumentType:
        billingDetails.documentType === "invoice"
          ? "RUC"
          : normalize(billingDetails.customerDocumentType)?.toUpperCase() ?? "DNI",
      customerDocumentNumber: normalize(billingDetails.customerDocumentNumber) ?? "",
      customerName: normalize(billingDetails.customerName) ?? "",
      customerEmail: normalize(billingDetails.customerEmail),
      customerAddress: normalize(billingDetails.customerAddress),
    };

    if (fulfillmentType === "delivery") {
      return {
        tenantId,
        couponCode: normalize(couponCode)?.toUpperCase(),
        fulfillmentType,
        deliveryDistrict: normalize(deliveryAddress.district),
        deliveryWindow: normalize(deliveryWindow),
        shippingAddress: {
          fullName: normalize(deliveryAddress.fullName) ?? "",
          phone: normalize(deliveryAddress.phone) ?? "",
          line1: normalize(deliveryAddress.line1) ?? "",
          district: normalize(deliveryAddress.district) ?? "",
          city: normalize(deliveryAddress.city) ?? "",
          line2: normalize(deliveryAddress.line2),
          reference: normalize(deliveryAddress.reference),
        },
        billing: billingPayload,
        fulfillmentNotes: normalize(fulfillmentNotes),
      };
    }

    return {
      tenantId,
      couponCode: normalize(couponCode)?.toUpperCase(),
      fulfillmentType,
      pickup: {
        pickupPointId: normalize(pickupDetails.pickupPointId) ?? "",
        windowLabel: normalize(pickupDetails.windowLabel) ?? "",
      },
      billing: billingPayload,
      fulfillmentNotes: normalize(fulfillmentNotes),
    };
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }

    setCheckingOut(true);
    setError(null);

    try {
      const order = await authedRequest<{ id: string }>("/orders/checkout", {
        method: "POST",
        body: buildCheckoutBody(tenant.id),
      });

      const paymentSession = await authedRequest<{ checkoutUrl: string | null }>("/payments/checkout-session", {
        method: "POST",
        body: {
          orderId: order.id,
        },
      });

      if (paymentSession.checkoutUrl) {
        window.location.href = paymentSession.checkoutUrl;
      } else {
        router.push("/checkout/success");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        router.push("/checkout/success");
        return;
      }
      const message = err instanceof ApiError ? err.message : "No se pudo procesar checkout";
      setError(message);
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="fade-up rounded-2xl border border-border bg-card/70 p-5">
        <h1 className="text-2xl font-bold">Carrito {tenant ? `- ${tenant.name}` : ""}</h1>
        <p className="text-sm text-muted-foreground">Revisa cantidades, aplica cupón y finaliza la compra.</p>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !cart || cart.items.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8">
            <p className="text-sm text-muted-foreground">Tu carrito esta vacio.</p>
            <Link href={tenant ? `/tienda/${tenant.slug}` : "/"}>
              <Button>Volver a tienda</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
                        {item.productImageUrlSnapshot ? (
                          <Image
                            src={item.productImageUrlSnapshot}
                            alt={item.productNameSnapshot}
                            fill
                            sizes="64px"
                            quality={85}
                            className="object-cover object-center"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{item.productNameSnapshot}</h3>
                        <p className="text-sm text-muted-foreground">
                          Unitario: {formatMoney(item.unitPrice, cart.currency)} | Linea:{" "}
                          {formatMoney(item.lineTotal, cart.currency)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => void updateItem(item.id, item.quantity - 1)}>
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                      <Button variant="outline" size="sm" onClick={() => void updateItem(item.id, item.quantity + 1)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void removeItem(item.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={checkout} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Metodo de entrega</label>
                  <select
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={fulfillmentType}
                    onChange={(event) => setFulfillmentType(event.target.value as FulfillmentType)}
                  >
                    <option value="delivery">Delivery a domicilio</option>
                    <option value="pickup">Recojo en tienda</option>
                  </select>
                </div>

                {fulfillmentType === "delivery" ? (
                  <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">Direccion de delivery</p>
                    <Input
                      placeholder="Nombre de quien recibe"
                      value={deliveryAddress.fullName}
                      onChange={(event) =>
                        setDeliveryAddress((previous) => ({
                          ...previous,
                          fullName: event.target.value,
                        }))
                      }
                      required
                    />
                    <Input
                      placeholder="Telefono"
                      value={deliveryAddress.phone}
                      onChange={(event) =>
                        setDeliveryAddress((previous) => ({
                          ...previous,
                          phone: event.target.value,
                        }))
                      }
                      required
                    />
                    <Input
                      placeholder="Direccion principal"
                      value={deliveryAddress.line1}
                      onChange={(event) =>
                        setDeliveryAddress((previous) => ({
                          ...previous,
                          line1: event.target.value,
                        }))
                      }
                      required
                    />
                    <Input
                      placeholder="Referencia (opcional)"
                      value={deliveryAddress.reference}
                      onChange={(event) =>
                        setDeliveryAddress((previous) => ({
                          ...previous,
                          reference: event.target.value,
                        }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Input
                          placeholder="Distrito"
                          list="delivery-districts"
                          value={deliveryAddress.district}
                          onChange={(event) =>
                            setDeliveryAddress((previous) => ({
                              ...previous,
                              district: event.target.value,
                            }))
                          }
                          required
                        />
                        <datalist id="delivery-districts">
                          {deliveryDistrictOptions.map((district) => (
                            <option key={district} value={district} />
                          ))}
                        </datalist>
                      </div>
                      <Input
                        placeholder="Ciudad"
                        value={deliveryAddress.city}
                        onChange={(event) =>
                          setDeliveryAddress((previous) => ({
                            ...previous,
                            city: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                    <select
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      value={deliveryWindow}
                      onChange={(event) => setDeliveryWindow(event.target.value)}
                    >
                      <option value="Hoy 2pm - 6pm">Hoy 2pm - 6pm</option>
                      <option value="Hoy 6pm - 10pm">Hoy 6pm - 10pm</option>
                      <option value="Mañana 9am - 1pm">Mañana 9am - 1pm</option>
                      <option value="Mañana 2pm - 6pm">Mañana 2pm - 6pm</option>
                    </select>
                    {selectedDeliveryZone ? (
                      <p className="text-xs text-muted-foreground">Zona de cobertura: {selectedDeliveryZone}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Ingresa un distrito cubierto para calcular tarifa y tiempo real.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">Datos de recojo</p>
                    <select
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      value={pickupDetails.pickupPointId}
                      onChange={(event) => {
                        const nextPoint = pickupPoints.find((point) => point.id === event.target.value) ?? null;
                        setPickupDetails((previous) => ({
                          ...previous,
                          pickupPointId: event.target.value,
                          windowLabel: nextPoint?.windows[0] ?? "Recojo coordinado",
                        }));
                      }}
                    >
                      {pickupPoints.map((point) => (
                        <option key={point.id} value={point.id}>
                          {point.name}
                        </option>
                      ))}
                      {!pickupPoints.length ? <option value="">Sin sedes disponibles</option> : null}
                    </select>
                    {selectedPickupPoint?.address ? (
                      <p className="text-xs text-muted-foreground">{selectedPickupPoint.address}</p>
                    ) : null}
                    <select
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      value={pickupDetails.windowLabel}
                      onChange={(event) =>
                        setPickupDetails((previous) => ({
                          ...previous,
                          windowLabel: event.target.value,
                        }))
                      }
                    >
                      {pickupWindows.map((windowLabel) => (
                        <option key={windowLabel} value={windowLabel}>
                          {windowLabel}
                        </option>
                      ))}
                      {!pickupWindows.length ? <option value="Recojo coordinado">Recojo coordinado</option> : null}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      El horario de recojo se define solo por franja.
                    </p>
                    {!pickupPoints.length ? (
                      <p className="text-xs text-amber-700">
                        Esta tienda no tiene sedes de recojo activas. Elige delivery o avisa al administrador.
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-sm font-medium">Comprobante</label>
                  <select
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={billingDetails.documentType}
                    onChange={(event) => {
                      const nextType = event.target.value as BillingDocumentType;
                      setBillingDetails((previous) => ({
                        ...previous,
                        documentType: nextType,
                        customerDocumentType: nextType === "invoice" ? "RUC" : previous.customerDocumentType,
                      }));
                    }}
                  >
                    <option value="receipt">Boleta</option>
                    <option value="invoice">Factura</option>
                  </select>
                </div>

                <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium">Datos para comprobante</p>
                  {billingDetails.documentType === "receipt" ? (
                    <select
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      value={billingDetails.customerDocumentType}
                      onChange={(event) =>
                        setBillingDetails((previous) => ({
                          ...previous,
                          customerDocumentType: event.target.value.toUpperCase(),
                        }))
                      }
                    >
                      <option value="DNI">DNI</option>
                      <option value="CE">CE</option>
                      <option value="PASSPORT">Pasaporte</option>
                    </select>
                  ) : (
                    <Input value="RUC" disabled />
                  )}
                  <Input
                    placeholder={billingDetails.documentType === "invoice" ? "RUC (11 digitos)" : "Numero de documento"}
                    value={billingDetails.customerDocumentNumber}
                    onChange={(event) =>
                      setBillingDetails((previous) => ({
                        ...previous,
                        customerDocumentNumber: event.target.value,
                      }))
                    }
                    required
                  />
                  <Input
                    placeholder={billingDetails.documentType === "invoice" ? "Razon social" : "Nombre completo"}
                    value={billingDetails.customerName}
                    onChange={(event) =>
                      setBillingDetails((previous) => ({
                        ...previous,
                        customerName: event.target.value,
                      }))
                    }
                    required
                  />
                  <Input
                    placeholder="Correo para envio (opcional)"
                    type="email"
                    value={billingDetails.customerEmail}
                    onChange={(event) =>
                      setBillingDetails((previous) => ({
                        ...previous,
                        customerEmail: event.target.value,
                      }))
                    }
                  />
                  <Input
                    placeholder={
                      billingDetails.documentType === "invoice"
                        ? "Direccion fiscal"
                        : "Direccion (opcional)"
                    }
                    value={billingDetails.customerAddress}
                    onChange={(event) =>
                      setBillingDetails((previous) => ({
                        ...previous,
                        customerAddress: event.target.value,
                      }))
                    }
                    required={billingDetails.documentType === "invoice"}
                  />
                  {billingDetails.documentType === "invoice" ? (
                    <p className="text-xs text-muted-foreground">
                      Para factura se requiere RUC valido y direccion fiscal.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Notas (opcional)</label>
                  <Input
                    placeholder="Indicaciones de entrega o recojo"
                    value={fulfillmentNotes}
                    onChange={(event) => setFulfillmentNotes(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Cupón (opcional)</label>
                  <Input
                    placeholder="OFF10"
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value)}
                  />
                  {validatingCoupon ? (
                    <p className="text-xs text-muted-foreground">Validando cupón...</p>
                  ) : null}
                  {couponMessage ? (
                    <p className={`text-xs ${couponEvaluation?.eligible === false ? "text-amber-700" : "text-emerald-700"}`}>
                      {couponMessage}
                    </p>
                  ) : null}
                  {couponError ? <p className="text-xs text-rose-700">{couponError}</p> : null}
                  {couponEvaluation ? (
                    <div
                      className={`space-y-2 rounded-xl border px-3 py-2 text-xs ${
                        couponEvaluation.eligible
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <p className="font-medium">
                        {getCouponCustomerTitle(couponEvaluation)} · {couponEvaluation.code}
                      </p>
                      {couponEvaluation.feedback.scope === "volume" ? (
                        <>
                          <p>
                            Progreso: {couponEvaluation.feedback.matchedQuantity ?? 0} / {couponEvaluation.feedback.requiredQuantity ?? 0} unidades
                          </p>
                          {couponEvaluation.feedback.missingQuantity ? (
                            <p>Faltan {couponEvaluation.feedback.missingQuantity} unidades para activar el descuento.</p>
                          ) : null}
                        </>
                      ) : null}
                      {couponEvaluation.feedback.scope === "bundle" && couponEvaluation.eligible === false ? (
                        <>
                          {couponEvaluation.feedback.missingProducts?.length ? (
                            <p>Productos faltantes: {formatCouponReferences(couponEvaluation.feedback.missingProducts)}</p>
                          ) : null}
                          {couponEvaluation.feedback.missingCategories?.length ? (
                            <p>Categorias faltantes: {formatCouponReferences(couponEvaluation.feedback.missingCategories)}</p>
                          ) : null}
                        </>
                      ) : null}
                      {couponEvaluation.feedback.targetProducts?.length ? (
                        <p>Aplica sobre productos: {formatCouponReferences(couponEvaluation.feedback.targetProducts)}</p>
                      ) : null}
                      {couponEvaluation.feedback.targetCategories?.length ? (
                        <p>Aplica sobre categorias: {formatCouponReferences(couponEvaluation.feedback.targetCategories)}</p>
                      ) : null}
                      {couponEvaluation.feedback.scope === "bundle" && couponEvaluation.feedback.requiredProducts?.length ? (
                        <p>Productos requeridos: {formatCouponReferences(couponEvaluation.feedback.requiredProducts)}</p>
                      ) : null}
                      {couponEvaluation.feedback.scope === "bundle" && couponEvaluation.feedback.requiredCategories?.length ? (
                        <p>Categorías requeridas: {formatCouponReferences(couponEvaluation.feedback.requiredCategories)}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatMoney(checkoutPreview?.subtotal ?? cart.subtotal, checkoutPreview?.currency ?? cart.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Descuento</span>
                    <span>
                      {formatMoney(
                        checkoutPreview?.discountTotal ?? cart.discountTotal,
                        checkoutPreview?.currency ?? cart.currency,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{fulfillmentType === "delivery" ? "Delivery" : "Recojo"}</span>
                    <span>
                      {formatMoney(
                        checkoutPreview?.shippingFee ?? fallbackShippingFee,
                        checkoutPreview?.currency ?? cart.currency,
                      )}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
                    <span>Total <span className="text-xs text-muted-foreground">
                      (Incluye IGV)
                    </span></span>
                    <span>
                      {formatMoney(
                        checkoutPreview?.total ?? (Number(cart.total) + Number(fallbackShippingFee)).toFixed(2),
                        checkoutPreview?.currency ?? cart.currency,
                      )}
                    </span>
                  </div>
                  {checkoutPreview?.estimatedFulfillmentAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Estimado: {formatDateTime(checkoutPreview.estimatedFulfillmentAt)}
                    </p>
                  ) : null}
                  {fulfillmentType === "delivery" && (checkoutPreview?.deliveryWindow || deliveryWindow) ? (
                    <p className="text-xs text-muted-foreground">
                      Ventana: {checkoutPreview?.deliveryWindow ?? deliveryWindow}
                    </p>
                  ) : null}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={checkingOut || validatingCoupon || checkoutBlockedForPickup}
                >
                  {checkingOut ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    "Finalizar compra"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
