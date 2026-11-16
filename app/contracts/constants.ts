export const Session = {
  cookieName: "factura_admin_sid",
  maxAgeMs: 8 * 60 * 60 * 1000,
} as const;

export const MAX_ORDER_ITEM_QUANTITY = 50;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;
