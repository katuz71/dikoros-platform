export type ProductDetailSectionSource = {
  description?: unknown;
  usage?: unknown;
  composition?: unknown;
  usage_contraindications?: unknown;
  usageContraindications?: unknown;
  combined_usage?: unknown;
  combinedUsage?: unknown;
};

type ProductTextNormalizer = (value: unknown) => string;

const combineProductInfoText = (...values: string[]) => {
  const seen = new Set<string>();

  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');
};

export const getProductDetailSections = (
  product: ProductDetailSectionSource | null | undefined,
  normalizeText: ProductTextNormalizer,
) => ({
  description: normalizeText(product?.description),
  usageContraindications: combineProductInfoText(
    normalizeText(product?.usage_contraindications),
    normalizeText(product?.usageContraindications),
    normalizeText(product?.combined_usage),
    normalizeText(product?.combinedUsage),
    normalizeText(product?.usage),
    normalizeText(product?.composition),
  ),
});
