import { PieChart, Pie, Tooltip, ResponsiveContainer } from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { CashFlowToday, CashFlowMonth } from '@/types/cashflow.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
const plnDec = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 });

interface BalanceDonutProps {
  today: CashFlowToday;
  month: CashFlowMonth;
}

interface Segment {
  name: string;
  value: number;
  color: string;
  fill: string;
}

export function BalanceDonut({ today, month }: BalanceDonutProps) {
  const balanceIsSet = Boolean(today.balance_updated_at);

  // ── Revenue breakdown donut ─────────────────────────────────────────────
  const totalRevenue = month.revenue_paid + month.b2c_revenue;
  const costsOp = month.costs_ksef + month.costs_quick + month.costs_fixed;
  const costsTax = month.vat_to_pay + month.zus_social + month.zus_health + month.pit_estimate;
  const yoursRaw = month.really_yours_estimate;
  const yoursPositive = Math.max(yoursRaw, 0);

  const isLoss = yoursRaw < 0;

  // Build donut segments — only shown when profitable (no loss distortion)
  const segments: Segment[] = [];
  if (!isLoss) {
    if (costsOp > 0)       segments.push({ name: 'Koszty operacyjne', value: costsOp,       color: '#f97316', fill: '#f97316' });
    if (costsTax > 0)      segments.push({ name: 'Podatki i ZUS',      value: costsTax,      color: '#eab308', fill: '#eab308' });
    if (yoursPositive > 0) segments.push({ name: 'Czysty zysk',        value: yoursPositive, color: '#22c55e', fill: '#22c55e' });
  }

  const hasRevenueData = totalRevenue > 0 || costsOp > 0;

  // ── Balance bar ─────────────────────────────────────────────────────────
  const totalAvailable = today.total_available;
  const totalReserved = today.total_reserved;
  const freeAfterTax = Math.max(totalAvailable - totalReserved, 0);
  const reservedPct = totalAvailable > 0 ? Math.min((totalReserved / totalAvailable) * 100, 100) : 100;
  const freePct = 100 - reservedPct;

  return (
    <div className="space-y-5">
      {/* ── Revenue / cost donut ── */}
      {hasRevenueData && (
        <div className="rounded-2xl border border-border p-4 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Gdzie idą przychody?
          </h3>

          {isLoss ? (
            /* ── Deficit state — replaces donut ── */
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <span className="text-xl shrink-0">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-red-700">
                    Strata w tym miesiącu: {plnDec.format(Math.abs(yoursRaw))}
                  </p>
                  <p className="text-xs text-red-500 mt-0.5">
                    Koszty i zobowiązania przekraczają opłacone przychody.
                  </p>
                </div>
              </div>
              <div className="space-y-2.5">
                {costsOp > 0 && (
                  <LegendRow color="#f97316" label="Koszty operacyjne" amount={costsOp} totalRevenue={totalRevenue} hidePct />
                )}
                {costsTax > 0 && (
                  <LegendRow color="#eab308" label="Podatki i ZUS" amount={costsTax} totalRevenue={totalRevenue} hidePct sub={[
                    month.vat_to_pay > 0   ? { label: 'VAT',           amount: month.vat_to_pay }   : null,
                    month.zus_social > 0   ? { label: 'ZUS społ.',     amount: month.zus_social }   : null,
                    month.zus_health > 0   ? { label: 'Zdrowotna',     amount: month.zus_health }   : null,
                    month.pit_estimate > 0 ? { label: 'Podatek doch.', amount: month.pit_estimate } : null,
                  ].filter(Boolean) as { label: string; amount: number }[]} />
                )}
                <div className="flex items-center justify-between text-sm border-t border-border pt-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-destructive" />
                    <span className="font-medium text-destructive">Strata</span>
                  </div>
                  <span className="font-semibold tabular-nums text-destructive">{plnDec.format(yoursRaw)}</span>
                </div>
              </div>
            </div>
          ) : segments.length > 0 ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
              {/* Donut */}
              <div className="relative w-full max-w-[170px] shrink-0">
                <ResponsiveContainer width="100%" aspect={1}>
                  <PieChart>
                    <Pie
                      data={segments}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="54%"
                      outerRadius="80%"
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={2}
                      isAnimationActive={false}
                      strokeWidth={0}
                    />
                    <Tooltip
                      formatter={(value: ValueType | undefined, name: NameType | undefined) =>
                        [plnDec.format(Number(value ?? 0)), String(name ?? '')] as [string, string]
                      }
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                  <span className="text-[10px] text-muted-foreground leading-none">Przychody</span>
                  <span className="text-sm font-bold leading-snug">{pln.format(totalRevenue)}</span>
                </div>
              </div>

              {/* Legend */}
              <div className="flex-1 w-full space-y-2.5">
                {costsOp > 0 && (
                  <LegendRow color="#f97316" label="Koszty operacyjne" amount={costsOp} totalRevenue={totalRevenue} />
                )}
                {costsTax > 0 && (
                  <LegendRow color="#eab308" label="Podatki i ZUS" amount={costsTax} totalRevenue={totalRevenue} sub={[
                    month.vat_to_pay > 0   ? { label: 'VAT',           amount: month.vat_to_pay }   : null,
                    month.zus_social > 0   ? { label: 'ZUS społ.',     amount: month.zus_social }   : null,
                    month.zus_health > 0   ? { label: 'Zdrowotna',     amount: month.zus_health }   : null,
                    month.pit_estimate > 0 ? { label: 'Podatek doch.', amount: month.pit_estimate } : null,
                  ].filter(Boolean) as { label: string; amount: number }[]} />
                )}
                {yoursPositive > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-green-500" />
                      <span className="font-medium">Czysty zysk (na rękę)</span>
                    </div>
                    <span className="font-semibold tabular-nums text-green-600">{plnDec.format(yoursRaw)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              Brak przychodów w tym miesiącu.
            </p>
          )}
        </div>
      )}

      {/* ── Cost breakdown bars ── */}
      {costsOp > 0 && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Struktura kosztów
          </h3>
          <CostBar label="Faktury zakupowe (KSeF)" amount={month.costs_ksef} total={costsOp} color="#f97316" />
          <CostBar label="Koszty gotówkowe"          amount={month.costs_quick} total={costsOp} color="#fb923c" />
          <CostBar label="Koszty stałe"              amount={month.costs_fixed} total={costsOp} color="#fdba74" />
        </div>
      )}

      {/* ── Balance section (optional) ── */}
      {balanceIsSet && totalAvailable > 0 && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Stan konta
            </h3>
            <span className="text-sm font-bold">{plnDec.format(totalAvailable)}</span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {totalReserved > 0 && (
                <div
                  className="h-full bg-orange-400 transition-all"
                  style={{ width: `${reservedPct}%` }}
                />
              )}
              {freeAfterTax > 0 && (
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${freePct}%` }}
                />
              )}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-400" />
                Zarezerwowane na zobowiązania: {plnDec.format(totalReserved)}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                Wolne: {plnDec.format(freeAfterTax)}
              </span>
            </div>
          </div>

          {today.really_yours < 0 && (
            <p className="text-xs text-destructive text-center">
              Zobowiązania przekraczają dostępne saldo o {plnDec.format(Math.abs(today.really_yours))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 });

function LegendRow({
  color,
  label,
  amount,
  totalRevenue,
  sub,
  hidePct = false,
}: {
  color: string;
  label: string;
  amount: number;
  totalRevenue: number;
  sub?: { label: string; amount: number }[];
  hidePct?: boolean;
}) {
  const pct = totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-muted-foreground">{label}</span>
          {!hidePct && <span className="text-xs text-muted-foreground/60">{pct}%</span>}
        </div>
        <span className="font-medium tabular-nums">{plnFmt.format(amount)}</span>
      </div>
      {sub && sub.length > 0 && (
        <div className="ml-4 space-y-0.5">
          {sub.map((s, i) => (
            <div key={i} className="flex justify-between text-xs text-muted-foreground">
              <span>{s.label}</span>
              <span className="tabular-nums">{plnFmt.format(s.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CostBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  if (amount <= 0) return null;
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{plnFmt.format(amount)}</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-right text-[10px] text-muted-foreground">{pct}% kosztów</p>
    </div>
  );
}
