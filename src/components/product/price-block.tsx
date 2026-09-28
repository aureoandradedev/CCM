import { formatBRL, formatUnit, splitBRL } from "@/lib/utils/format";
import { hasWholesale, installmentPlan, offerDiscountPct, pixPrice, wholesaleSavingsPct, type PriceLike } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface PriceBlockProps extends PriceLike {
  unit: string;
  /** "card" = compacto; "detail" = página do produto */
  variant?: "card" | "detail";
  className?: string;
}

/**
 * Bloco de preço padrão da Multigiro Central de Compras (usado no card e na página do produto):
 *  - preço "de" riscado quando há oferta
 *  - preço varejo em destaque + unidade
 *  - "no Pix" em verde (Telhanorte)
 *  - faixa laranja do atacado com a quantidade mínima (Obramax)
 */
export function PriceBlock({ unit, variant = "card", className, ...p }: PriceBlockProps) {
  const off = offerDiscountPct(p);
  const price = splitBRL(p.retailPrice);
  const pix = pixPrice(p.retailPrice, p.pixDiscountPct);
  const wholesale = hasWholesale(p);
  const detail = variant === "detail";
  const plan = detail ? installmentPlan(p.retailPrice) : null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {off > 0 && p.listPrice ? (
        <div className="flex items-center gap-2 text-xs text-brand-ink-soft">
          <span className="price-strike">{formatBRL(p.listPrice)}</span>
          <span className="rounded-md bg-brand-red/10 px-1.5 py-0.5 text-[0.7rem] font-bold text-brand-red">-{off}%</span>
        </div>
      ) : null}

      <div className="flex items-baseline gap-1 text-brand-navy dark:text-foreground">
        <span className={cn("font-heading font-extrabold leading-none tracking-tight", detail ? "text-[2.4rem]" : "text-[1.55rem]")}>
          <span className={cn("mr-0.5 align-top font-bold", detail ? "text-lg" : "text-sm")}>{price.symbol}</span>
          {price.int}
          <span className={cn(detail ? "text-2xl" : "text-base")}>,{price.cents}</span>
        </span>
        <span className="text-xs font-medium text-brand-ink-soft">/{formatUnit(unit)}</span>
      </div>

      <div className={cn("flex flex-wrap items-center gap-x-2 text-brand-green", detail ? "text-sm" : "text-xs")}>
        <span className="font-semibold">{formatBRL(pix)} no Pix</span>
        {plan && plan.count > 1 ? (
          <span className="text-brand-ink-soft">
            ou {plan.count}x de {formatBRL(plan.value)} sem juros
          </span>
        ) : null}
      </div>

      {wholesale ? (
        <div
          className={cn(
            "mt-1 flex items-center gap-2 rounded-lg bg-brand-orange-soft px-2 py-1.5 text-brand-navy dark:text-foreground",
            detail ? "text-sm" : "text-xs",
          )}
        >
          <span className="rounded-md bg-brand-orange px-1.5 py-0.5 text-[0.65rem] font-extrabold uppercase tracking-wide text-white">
            Atacado
          </span>
          <span className="leading-tight">
            <strong className="font-heading font-bold">{formatBRL(p.wholesalePrice as number)}</strong>
            <span className="text-brand-ink-soft">/{formatUnit(unit)}</span>
            {" "}a partir de <strong>{p.wholesaleMinQty} {formatUnit(unit)}</strong>
            {detail ? <span className="text-brand-ink-soft"> · economize {wholesaleSavingsPct(p)}%</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
