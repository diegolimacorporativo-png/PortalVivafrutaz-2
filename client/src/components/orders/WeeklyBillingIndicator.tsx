type WeeklyBillingIndicatorProps = {
  total: number;
  minimum: number;
  label?: string;
};

function fmtBRL(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Shared presentation for the weekly minimum billing status.
 * The pages remain responsible for supplying their already-calculated total.
 */
export function WeeklyBillingIndicator({
  total,
  minimum,
  label = "Faturamento semanal",
}: WeeklyBillingIndicatorProps) {
  if (minimum <= 0) return null;

  const reachedMinimum = total >= minimum;
  const shortfall = Math.max(0, minimum - total);

  return (
    <div
      data-testid="weekly-billing-indicator"
      className={`rounded-xl border p-3 text-xs ${
        reachedMinimum
          ? "border-green-200 bg-green-50"
          : "border-orange-200 bg-orange-50"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`font-bold ${reachedMinimum ? "text-green-700" : "text-orange-700"}`}>
          {label}
        </span>
        <span className={`font-bold ${reachedMinimum ? "text-green-700" : "text-orange-700"}`}>
          R$ {fmtBRL(total)} / R$ {fmtBRL(minimum)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/60">
        <div
          className={`h-1.5 rounded-full transition-all ${
            reachedMinimum ? "bg-green-500" : "bg-orange-400"
          }`}
          style={{ width: `${Math.min(100, (total / minimum) * 100)}%` }}
        />
      </div>
      {shortfall > 0 ? (
        <p className="mt-1.5 font-medium text-orange-600">
          Faltam R$ {fmtBRL(shortfall)} para o mínimo semanal.
        </p>
      ) : (
        <p className="mt-1.5 font-medium text-green-700">
          Mínimo semanal atingido.
        </p>
      )}
    </div>
  );
}