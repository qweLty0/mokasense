// Bulgu üreticisi #5 — Hakediş (Aşama 2).
// "Yarına geçecek net tutar" + ay sonu nakit akışı projeksiyonu.
// Ürün kuralı: komisyon oranı/tutarı/dökümü GÖSTERİLMEZ. Sadece NET sonuç.

import type { Merchant, Transaction } from "../types";
import type { Finding } from "./types";
import {
  LAST_DAY_INDEX,
  NOW_DATE,
  dateOfIndex,
  dayIndexOfTs,
  indexOfDate,
  mean,
  safeDiv,
  tf,
} from "./util";

/**
 * Dahili efektif hakediş kesinti oranı (valör/işlem maliyeti yaklaşık).
 * ASLA çıktıya kalem olarak yazılmaz — yalnız NET tutarı türetmek için kullanılır.
 */
const NET_SETTLEMENT_FACTOR = 0.982;

/** Bir ISO günün ay-sonu gün sayısı. */
function daysInMonth(dateStr: string): number {
  const y = Number(dateStr.slice(0, 4));
  const mo = Number(dateStr.slice(5, 7));
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function settlementFindings(
  m: Merchant,
  txs: Transaction[],
  // mx paramı arayüz tutarlılığı için; hesap ham işlemlerden yapılır
): Finding[] {
  // --- Yarına geçecek net (son günün tek çekim, onaylı & iadesiz işlemleri) ---
  let tomorrowGross = 0;
  let tomorrowCount = 0;
  let deferredInstallmentGross = 0;
  for (const tx of txs) {
    if (dayIndexOfTs(tx.timestamp) !== LAST_DAY_INDEX) continue;
    if (tx.status !== "approved" || tx.refunded) continue;
    if (tx.installments > 1) {
      deferredInstallmentGross += tx.amount;
    } else {
      tomorrowGross += tx.amount;
      tomorrowCount++;
    }
  }
  const netTomorrow = tomorrowGross * NET_SETTLEMENT_FACTOR;
  const valueDate = dateOfIndex(LAST_DAY_INDEX + 1); // T+1 valör

  // --- Ay sonu nakit akışı projeksiyonu ---
  const monthStartIdx = indexOfDate(`${NOW_DATE.slice(0, 7)}-01`);
  const dim = daysInMonth(NOW_DATE);
  const monthEndIdx = indexOfDate(`${NOW_DATE.slice(0, 7)}-${String(dim).padStart(2, "0")}`);
  const remainingDays = monthEndIdx - LAST_DAY_INDEX;

  // Ay içi gerçekleşen net + son 14 günün günlük net ortalamasıyla projeksiyon
  let monthToDateGross = 0;
  const last14: Map<number, number> = new Map();
  for (const tx of txs) {
    if (tx.status !== "approved" || tx.refunded) continue;
    const d = dayIndexOfTs(tx.timestamp);
    if (d >= monthStartIdx && d <= LAST_DAY_INDEX) monthToDateGross += tx.amount;
    if (d >= LAST_DAY_INDEX - 13) last14.set(d, (last14.get(d) ?? 0) + tx.amount);
  }
  const dailyNetSamples = [...last14.values()].map((v) => v * NET_SETTLEMENT_FACTOR);
  const avgDailyNet = mean(dailyNetSamples);
  const monthToDateNet = monthToDateGross * NET_SETTLEMENT_FACTOR;
  const projectedMonthEndNet = monthToDateNet + avgDailyNet * remainingDays;

  const finding: Finding = {
    id: `${m.id}:hakedis:net`,
    merchantId: m.id,
    type: "hakedis_net",
    severity: "bilgi",
    category: "hakedis",
    metrics: {
      netTomorrow,
      valueDate,
      tomorrowCount,
      deferredInstallmentAmount: deferredInstallmentGross,
      monthToDateNet,
      avgDailyNet,
      remainingDaysInMonth: remainingDays,
      projectedMonthEndNet,
    },
    suggestedAction: null,
    timeframe: tf("hakedis", LAST_DAY_INDEX, LAST_DAY_INDEX),
    confidence: 0.9,
  };

  return [finding];
}
