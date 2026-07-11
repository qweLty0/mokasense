// Tek-geçiş agrega üreteci. Ham işlemleri BİR KEZ okuyup MerchantMetrics çıkarır.
// Downstream üreticiler (özet/benchmark/çapraz satış) bu agregadan beslenir;
// sadakat/anomali/hakediş ise ek olarak ham işlemlere bakar.

import type { Channel, Merchant, Transaction } from "../types";
import type { BenchmarkPool, MerchantMetrics, WeekPoint } from "./types";
import type { Sector } from "../types";
import {
  LAST_DAY_INDEX,
  dayIndexOfTs,
  hourOfTs,
  dowOfIndex,
  weekStartOf,
  median,
  safeDiv,
  sumRange,
} from "./util";

/**
 * Onaylı işlemlerden müşteri (cardToken) ziyaret-günü haritası kurar.
 * Değer: o tokenın onaylı işlem yaptığı gün indeksleri (artan sırada).
 * Sadakat oranı ve dönüş döngüsü buradan hesaplanır. Saf fonksiyon.
 */
export function buildCustomerMap(txs: Transaction[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const tx of txs) {
    if (tx.status !== "approved") continue;
    const d = dayIndexOfTs(tx.timestamp);
    const arr = map.get(tx.cardToken);
    if (arr) arr.push(d);
    else map.set(tx.cardToken, [d]);
  }
  return map;
}

/** Bir tokenın benzersiz ziyaret günleri (aynı gün tek sayılır), artan sıralı. */
export function distinctVisitDays(dayIdxs: number[]): number[] {
  return [...new Set(dayIdxs)].sort((a, b) => a - b);
}

/** Ardışık ziyaretler arası gün farkları (döngü hesabı için). */
export function visitGaps(sortedDistinctDays: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < sortedDistinctDays.length; i++) {
    gaps.push(sortedDistinctDays[i] - sortedDistinctDays[i - 1]);
  }
  return gaps;
}

// --- Kayıp sadık müşteri tespiti (sadakat modülü + metrik havuzu ortak kullanır) ---

/** Kayıp sadık müşteri eşikleri (kuaför 8 haftalık kayıp anomalisini yakalar). */
export const CHURN_MIN_VISITS = 3; // "yerleşik" sadık sayılmak için min. ziyaret
export const CHURN_OVERDUE_FACTOR = 1.5; // kendi döngüsünün kaç katı gecikirse kayıp
export const CHURN_MIN_SILENT_DAYS = 21; // en az bu kadar gündür görünmüyorsa
export const CHURN_MAX_SILENT_DAYS = 120; // recency kapısı: son ~4 ayda aktifken kaybolan

export interface LostCustomer {
  token: string;
  visits: number;
  cycleDays: number;
  lastVisitDay: number;
  silentDays: number;
  missedVisits: number;
}

/** Müşteri haritasından kayıp sadıkları çıkarır (saf, tekrar kullanılabilir). */
export function detectLostFromMap(custMap: Map<string, number[]>): LostCustomer[] {
  const lost: LostCustomer[] = [];
  for (const [token, days] of custMap.entries()) {
    const distinct = distinctVisitDays(days);
    if (distinct.length < CHURN_MIN_VISITS) continue;
    const cycle = median(visitGaps(distinct));
    if (cycle <= 0) continue;
    const lastVisitDay = distinct[distinct.length - 1];
    const silentDays = LAST_DAY_INDEX - lastVisitDay;
    // Kayıp: kendi kadansını 1.5 kat aştı VE son ~4 ay içinde aktifti (recency).
    if (
      silentDays > cycle * CHURN_OVERDUE_FACTOR &&
      silentDays >= CHURN_MIN_SILENT_DAYS &&
      silentDays <= CHURN_MAX_SILENT_DAYS
    ) {
      lost.push({
        token,
        visits: distinct.length,
        cycleDays: cycle,
        lastVisitDay,
        silentDays,
        missedVisits: Math.floor(silentDays / cycle),
      });
    }
  }
  return lost;
}

/** Ham işlemlerden kayıp sadıkları çıkarır. */
export function detectLostLoyal(txs: Transaction[]): LostCustomer[] {
  return detectLostFromMap(buildCustomerMap(txs));
}

const EMPTY_CHANNELS = (): Record<Channel, number> => ({
  magaza: 0,
  online: 0,
  telefon: 0,
});

/**
 * Bir işyerinin tüm metriklerini tek geçişte hesaplar.
 * Ham txs sadece burada baştan sona taranır (performans kuralı).
 */
export function computeMerchantMetrics(
  merchant: Merchant,
  txs: Transaction[],
): MerchantMetrics {
  const dailyRevenue = new Array<number>(LAST_DAY_INDEX + 1).fill(0);
  const dailyCount = new Array<number>(LAST_DAY_INDEX + 1).fill(0);
  const hourRevenue = new Array<number>(24).fill(0);
  const dowRevenue = new Array<number>(7).fill(0);
  const dowCount = new Array<number>(7).fill(0);
  const channelCounts = EMPTY_CHANNELS();
  const weeklyMap = new Map<string, { revenue: number; count: number }>();

  let approvedCount = 0;
  let declinedCount = 0;
  let refundedCount = 0;
  let netRevenue = 0;
  let netTicketCount = 0;
  let foreignCount = 0;
  let installmentApproved = 0;
  let contactlessCount = 0;

  // Yabancı kart son-dönem vs baz (çapraz satış için)
  const foreignRecentStart = LAST_DAY_INDEX - 29;
  let recentTotal = 0;
  let recentForeign = 0;
  let baselineTotal = 0;
  let baselineForeign = 0;

  for (const tx of txs) {
    const dIdx = dayIndexOfTs(tx.timestamp);
    const dow = dowOfIndex(dIdx);

    if (tx.cardOrigin === "foreign") foreignCount++;
    if (dIdx >= foreignRecentStart) {
      recentTotal++;
      if (tx.cardOrigin === "foreign") recentForeign++;
    } else {
      baselineTotal++;
      if (tx.cardOrigin === "foreign") baselineForeign++;
    }

    if (tx.status === "declined") {
      declinedCount++;
      continue; // reddedilen ciroya/kanal payına girmez
    }

    approvedCount++;
    channelCounts[tx.channel]++;
    if (tx.installments > 1) installmentApproved++;
    if (tx.contactless) contactlessCount++;
    if (tx.refunded) refundedCount++;

    // Ciro yalnızca onaylı & iade edilmemiş işlemlerden
    if (!tx.refunded) {
      netRevenue += tx.amount;
      netTicketCount++;
      dailyRevenue[dIdx] += tx.amount;
      dailyCount[dIdx]++;
      hourRevenue[hourOfTs(tx.timestamp)] += tx.amount;
      dowRevenue[dow] += tx.amount;
      dowCount[dow]++;
      const wk = weekStartOf(tx.timestamp.slice(0, 10));
      const w = weeklyMap.get(wk);
      if (w) {
        w.revenue += tx.amount;
        w.count++;
      } else {
        weeklyMap.set(wk, { revenue: tx.amount, count: 1 });
      }
    }
  }

  const txCount = txs.length;
  const channelShare = EMPTY_CHANNELS();
  (Object.keys(channelCounts) as Channel[]).forEach((c) => {
    channelShare[c] = safeDiv(channelCounts[c], approvedCount);
  });

  const weekly: WeekPoint[] = [...weeklyMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, v]) => ({ weekStart, revenue: v.revenue, count: v.count }));

  // Kayan haftalık pencereler (NOW çıpalı)
  const thisWeekRevenue = sumRange(dailyRevenue, LAST_DAY_INDEX - 6, LAST_DAY_INDEX);
  const lastWeekRevenue = sumRange(dailyRevenue, LAST_DAY_INDEX - 13, LAST_DAY_INDEX - 7);
  const thisWeekCount = sumRange(dailyCount, LAST_DAY_INDEX - 6, LAST_DAY_INDEX);
  const w0 = thisWeekRevenue;
  const w1 = lastWeekRevenue;
  const w2 = sumRange(dailyRevenue, LAST_DAY_INDEX - 20, LAST_DAY_INDEX - 14);
  const w3 = sumRange(dailyRevenue, LAST_DAY_INDEX - 27, LAST_DAY_INDEX - 21);
  const avg4WeekRevenue = (w0 + w1 + w2 + w3) / 4;

  const thisWeekTicketCount = sumRange(dailyCount, LAST_DAY_INDEX - 6, LAST_DAY_INDEX);
  const prevTicketCount = sumRange(dailyCount, LAST_DAY_INDEX - 27, LAST_DAY_INDEX - 7);
  const prevRevenue = sumRange(dailyRevenue, LAST_DAY_INDEX - 27, LAST_DAY_INDEX - 7);
  const avgTicketThisWeek = safeDiv(thisWeekRevenue, thisWeekTicketCount);
  const avgTicketPrev = safeDiv(prevRevenue, prevTicketCount);

  // Yoğunluk
  let busiestDow = 0;
  for (let d = 1; d < 7; d++) if (dowRevenue[d] > dowRevenue[busiestDow]) busiestDow = d;
  let busiestHour = 0;
  for (let h = 1; h < 24; h++) if (hourRevenue[h] > hourRevenue[busiestHour]) busiestHour = h;
  // En yoğun 3 saatlik blok
  let busiestBlock = { start: 0, end: 2, revenue: 0 };
  for (let h = 0; h <= 21; h++) {
    const r = hourRevenue[h] + hourRevenue[h + 1] + hourRevenue[h + 2];
    if (r > busiestBlock.revenue) busiestBlock = { start: h, end: h + 2, revenue: r };
  }

  // Sadakat: müşteri haritasından
  const custMap = buildCustomerMap(txs);
  let repeatCustomers = 0;
  let totalVisits = 0;
  const cycleGaps: number[] = [];
  for (const days of custMap.values()) {
    const distinct = distinctVisitDays(days);
    totalVisits += distinct.length;
    if (distinct.length >= 2) {
      repeatCustomers++;
      for (const g of visitGaps(distinct)) cycleGaps.push(g);
    }
  }
  const distinctCustomers = custMap.size;
  const repeatCustomerRate = safeDiv(repeatCustomers, distinctCustomers);
  const avgVisitsPerCustomer = safeDiv(totalVisits, distinctCustomers);
  const medianReturnCycleDays = cycleGaps.length > 0 ? median(cycleGaps) : null;
  const lostLoyalCount = detectLostFromMap(custMap).length;

  return {
    merchantId: merchant.id,
    sector: merchant.sector,
    district: merchant.district,
    txCount,
    approvedCount,
    declinedCount,
    refundedCount,
    netRevenue,
    avgTicket: safeDiv(netRevenue, netTicketCount),
    declineRate: safeDiv(declinedCount, txCount),
    refundRate: safeDiv(refundedCount, approvedCount),
    foreignRate: safeDiv(foreignCount, txCount),
    installmentShare: safeDiv(installmentApproved, approvedCount),
    contactlessShare: safeDiv(contactlessCount, approvedCount),
    channelShare,
    channelCounts,
    dailyRevenue,
    dailyCount,
    weekly,
    hourRevenue,
    dowRevenue,
    dowCount,
    thisWeekRevenue,
    lastWeekRevenue,
    avg4WeekRevenue,
    thisWeekCount,
    avgTicketThisWeek,
    avgTicketPrev,
    busiestDow,
    busiestHour,
    busiestBlock,
    distinctCustomers,
    repeatCustomers,
    repeatCustomerRate,
    avgVisitsPerCustomer,
    medianReturnCycleDays,
    lostLoyalCount,
    foreignRateRecent: safeDiv(recentForeign, recentTotal),
    foreignRateBaseline: safeDiv(baselineForeign, baselineTotal),
  };
}

/** Tüm metriklerden benchmark havuzu kurar (sektör kırılımlı). */
export function buildBenchmarkPool(all: MerchantMetrics[]): BenchmarkPool {
  const bySector = {
    kasap: [],
    kafe: [],
    kuafor: [],
    eticaret: [],
  } as Record<Sector, MerchantMetrics[]>;
  for (const m of all) bySector[m.sector].push(m);
  return { all, bySector };
}
