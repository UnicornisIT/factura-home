export const Session = {
  cookieName: "glina_admin_sid",
  maxAgeMs: 8 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;
