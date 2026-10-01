export const SALES_OS_TENANT_ID = 'sales_os' as const;

export function assertSalesOsTenant(tenantId: string): void {
  if (tenantId !== SALES_OS_TENANT_ID) {
    throw new Error(`Invalid Sales OS tenant: expected ${SALES_OS_TENANT_ID}.`);
  }
}
