export const BILLING_JOBS_QUEUE = 'billing-jobs';
export const NOTIFICATIONS_JOBS_QUEUE = 'notifications-jobs';

export const BILLING_JOB_ISSUE_ORDER_DOCUMENT = 'billing.issue-order-document';
export const BILLING_JOB_ISSUE_CREDIT_NOTE = 'billing.issue-credit-note';
export const NOTIFICATION_JOB_ORDER_PAID_EMAIL = 'notifications.order-paid-email';
export const NOTIFICATION_JOB_ORDER_STATUS_CHANGED_EMAIL =
  'notifications.order-status-changed-email';

export type BillingIssueOrderDocumentJob = {
  orderId: string;
  trigger: string;
};

export type BillingIssueCreditNoteJob = {
  tenantId: string;
  orderId: string;
  refundId: string;
  amount: string;
  currency: string;
  reason: string | null;
  trigger: string;
};

export type NotificationOrderPaidEmailJob = {
  orderId: string;
};

export type NotificationOrderStatusChangedEmailJob = {
  orderId: string;
  previousStatus: string;
  nextStatus: string;
};
