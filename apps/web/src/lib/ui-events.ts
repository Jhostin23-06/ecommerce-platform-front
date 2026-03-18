export const APP_NOTIFY_EVENT = "app:notify";
export const CART_CHANGED_EVENT = "cart:changed";

export type NotifyPayload = {
  title: string;
  description?: string;
  tone?: "success" | "error" | "info";
};

export type CartChangedPayload = {
  itemsCount?: number;
};

export function notify(payload: NotifyPayload) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<NotifyPayload>(APP_NOTIFY_EVENT, { detail: payload }));
}

export function cartChanged(payload?: CartChangedPayload) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<CartChangedPayload>(CART_CHANGED_EVENT, { detail: payload }));
}
