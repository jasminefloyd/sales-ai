import { SALES_OS_TENANT_ID } from '../../domain/tenant';

export type ProductContact = {
  id: string;
  tenant_id: string;
  product_id: string;
  professional_email?: string | null;
};

export type ProductOpportunity = {
  id: string;
  tenant_id: string;
  product_id: string;
  dedupe_key: string;
};

export function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findContactForProduct(
  contacts: readonly ProductContact[],
  productId: string,
  contactId: string,
): ProductContact | undefined {
  return contacts.find(
    (contact) =>
      contact.tenant_id === SALES_OS_TENANT_ID &&
      contact.product_id === productId &&
      contact.id === contactId,
  );
}

export function hasDuplicateContact(
  contacts: readonly ProductContact[],
  productId: string,
  email: string,
): boolean {
  const normalizedEmail = normalizeContactEmail(email);
  return contacts.some(
    (contact) =>
      contact.tenant_id === SALES_OS_TENANT_ID &&
      contact.product_id === productId &&
      contact.professional_email &&
      normalizeContactEmail(contact.professional_email) === normalizedEmail,
  );
}

export function hasDuplicateOpportunity(
  opportunities: readonly ProductOpportunity[],
  productId: string,
  dedupeKey: string,
): boolean {
  return opportunities.some(
    (opportunity) =>
      opportunity.tenant_id === SALES_OS_TENANT_ID &&
      opportunity.product_id === productId &&
      opportunity.dedupe_key === dedupeKey,
  );
}
