import {
  catalogEntryFor,
  toolPricingFor,
  type ToolPricing,
} from "@prismshadow/penguin-server/model-catalog";
import { S } from "./strings";

interface ModelRef {
  provider: string;
  modelId: string;
  chatEligible?: boolean | undefined;
  referencePriceEligible?: false | undefined;
  baseUrl?: string | undefined;
  clientType?: string | undefined;
  effective?: { baseUrl?: string | undefined; clientType?: string | undefined } | undefined;
}

export function toolModelQuote(model: ModelRef, now = new Date()) {
  const entry = catalogEntryFor(model.provider, model.modelId);
  const pricing =
    entry?.toolPricing?.source === "mmsp" && model.referencePriceEligible === false
      ? undefined
      : toolPricingFor(entry, model.effective ?? model);
  if (!pricing) {
    if (!entry?.capability && model.chatEligible !== false) return undefined;
    return {
      primary: S.models.sellerPricing,
      details: [S.models.sellerPricing],
      published: false,
      reference: false,
    };
  }
  const discount =
    pricing.discount &&
    (!pricing.promotionEndsAt || now.getTime() < Date.parse(pricing.promotionEndsAt))
      ? pricing.discount
      : 0;
  const money = (amount: number) =>
    `${pricing.currency === "CNY" ? "¥" : "US$"}${Number(amount.toFixed(8))}`;
  const label = (rate: ToolPricing["rates"][number]) => {
    const unit = S.models.toolPriceUnits[rate.unit];
    if (discount > 0)
      return S.models.toolOffer(money(rate.amount * (1 - discount)), unit, money(rate.amount));
    const amount =
      rate.maximum === undefined
        ? money(rate.amount)
        : `${money(rate.amount)}–${money(rate.maximum)}`;
    return `${amount}/${unit}`;
  };
  const details = pricing.rates.map(label);
  const reference = pricing.source === "mmsp";
  const primary = reference ? S.models.mmspReferenceAmount(details[0]!) : details[0]!;
  return { primary, details, published: true, reference };
}
