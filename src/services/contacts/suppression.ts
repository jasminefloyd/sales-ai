import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type SuppressionRecord = {
  tenant_id: string;
  product_id: string;
  channel: string;
  identifier: string;
  active: boolean;
};

export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function isSuppressed(
  records: readonly SuppressionRecord[],
  productId: string,
  channel: string,
  identifier: string,
): boolean {
  const normalized = normalizeIdentifier(identifier);
  return records.some(
    (record) =>
      record.tenant_id === SALES_OS_TENANT_ID &&
      record.product_id === productId &&
      record.channel === channel &&
      record.active &&
      normalizeIdentifier(record.identifier) === normalized,
  );
}

export function buildSuppressionLookup(
  productId: string,
  channel: string,
  identifier: string,
) {
  return {
    tenant_id: SALES_OS_TENANT_ID,
    product_id: productId,
    channel,
    identifier: normalizeIdentifier(identifier),
    active: true,
  };
}
