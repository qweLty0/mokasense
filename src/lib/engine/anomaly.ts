// Bulgu üreticisi #4 — Anomali tespiti.
// (a) Ciro düşüşü: gün + saat dilimi hassasiyetinde (örnek kafe Salı-Çarş
//     14-17 çukuru), (b) red oranı artışı: baz çizgiye göre + hata kodu + tek
//     banka yoğunlaşması, (c) iade anomalisi: oran artışı + fiyat bandı.
// Her anomali: baz çizgi, sapma büyüklüğü, etkilenen tahmini ciro (TL).

import type { DeclineReason, Merchant, Transaction } from "../types";
import type { Finding, MerchantMetrics } from "./types";
import {
  LAST_DAY_INDEX,
  dayIndexOfTs,
  dowOfIndex,
  hourOfTs,
  mean,
  stdev,
  safeDiv,
  tf,
} from "./util";

// --- Eşikler ---------------------------------------------------------------
const DIP_DROP = 0.4; // dilim cirosu en az %40 düşmeli
const DIP_MIN_WEEKLY = 3000; // dilim baz cirosu anlamlı olmalı (ince/gürültülü dilimleri ele)
const DIP_Z = 2.5; // düşüş, farkın standart hatasının 2.5 katından büyük olmalı (gürültü filtresi)
const DIP_MIN_BASELINE_OCC = 6; // dilim için en az bu kadar geçmiş occurrence
const DIP_RECENT_OCC = 3; // son 3 occurrence (= son 3 hafta o gün)

const DECLINE_FLOOR = 0.06;
const DECLINE_FACTOR = 1.6;
const DECLINE_MIN_ABS = 0.03;
const DECLINE_MIN_TX = 20;

/** Genel oran-patlaması kararı (red için; saf ve test edilebilir). */
export function isRateSpike(
  baseline: number,
  recent: number,
  floor = DECLINE_FLOOR,
  factor = DECLINE_FACTOR,
  minAbs = DECLINE_MIN_ABS,
): boolean {
  return recent >= floor && recent >= baseline * factor && recent - baseline >= minAbs;
}

// --- (a) Ciro düşüşü: dilim (gün×saat) bazlı ------------------------------

interface SliceResult {
  dow: number;
  hourStart: number;
  baselineWeekly: number;
  recentWeekly: number;
  dropPct: number;
}

/**
 * Her (gün, 3-saatlik kayan pencere) dilimi için, o hafta gününün SON 3 gerçek
 * occurrence'ını (son 3 hafta o gün) önceki occurrence'larla kıyaslar. Occurrence
 * (tarih) bazlı çalıştığı için eksik/kısmi son ISO haftası yapay düşüş üretmez.
 * En az %30 düşen ve baz cirosu anlamlı dilimleri döndürür. Saf fonksiyon.
 */
export function detectRevenueDips(txs: Transaction[]): SliceResult[] {
  // dateStr -> hour[24] ciro (onaylı & iade edilmemiş)
  const dayGrid = new Map<string, number[]>();
  for (const tx of txs) {
    if (tx.status !== "approved" || tx.refunded) continue;
    const date = tx.timestamp.slice(0, 10);
    let hours = dayGrid.get(date);
    if (!hours) {
      hours = new Array<number>(24).fill(0);
      dayGrid.set(date, hours);
    }
    hours[hourOfTs(tx.timestamp)] += tx.amount;
  }

  // Tarihleri haftanın gününe göre grupla (her grup kronolojik sıralı)
  const datesByDow: string[][] = Array.from({ length: 7 }, () => []);
  for (const date of [...dayGrid.keys()].sort()) {
    datesByDow[dowOfIndex(dayIndexOfTs(`${date}T00:00:00`))].push(date);
  }

  const results: SliceResult[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const dates = datesByDow[dow];
    if (dates.length < DIP_MIN_BASELINE_OCC + DIP_RECENT_OCC) continue;
    const baselineDates = dates.slice(0, dates.length - DIP_RECENT_OCC);
    const recentDates = dates.slice(-DIP_RECENT_OCC);

    let best: SliceResult | null = null;
    for (let h = 6; h <= 21; h++) {
      const sliceRev = (date: string): number => {
        const g = dayGrid.get(date)!;
        return g[h] + g[h + 1] + g[h + 2];
      };
      const baselineSeries = baselineDates.map(sliceRev);
      const baselineWeekly = mean(baselineSeries);
      const recentWeekly = mean(recentDates.map(sliceRev));
      if (baselineWeekly < DIP_MIN_WEEKLY) continue;
      const dropPct = safeDiv(baselineWeekly - recentWeekly, baselineWeekly);
      // Gürültü filtresi (iki-örneklem): son 3 occurrence ORTALAMASI ile baz
      // ortalaması arasındaki fark, farkın standart hatasının 2.5 katından büyük
      // olmalı — yoksa 112 dilim taranınca rastgele düşükler yakalanır.
      const seDiff =
        stdev(baselineSeries) *
        Math.sqrt(1 / DIP_RECENT_OCC + 1 / baselineSeries.length);
      const significant = baselineWeekly - recentWeekly >= DIP_Z * seDiff;
      if (dropPct >= DIP_DROP && significant && (best === null || dropPct > best.dropPct)) {
        best = { dow, hourStart: h, baselineWeekly, recentWeekly, dropPct };
      }
    }
    if (best) results.push(best);
  }
  return results;
}

function revenueDipFinding(m: Merchant, txs: Transaction[]): Finding | null {
  const dips = detectRevenueDips(txs);
  if (dips.length === 0) return null;

  // En büyük kayıplı dilimi çıpa al, penceresi çakışan (±2 saat) günleri birleştir
  const lostOf = (s: SliceResult) => (s.baselineWeekly - s.recentWeekly) * DIP_RECENT_OCC;
  const anchor = dips.reduce((a, b) => (lostOf(b) > lostOf(a) ? b : a));
  const grouped = dips.filter((s) => Math.abs(s.hourStart - anchor.hourStart) <= 2);
  const affectedDows = [...new Set(grouped.map((s) => s.dow))].sort((a, b) => a - b);

  // YAPISAL dip şartı: aynı saat penceresinde EN AZ 2 farklı gün. Gerçek bir
  // zaman-dilimi erozyonu tekrar eden günlerde görünür; tek dilim düşüşü ise 112
  // dilim taranınca kaçınılmaz çıkan istatistik gürültüdür ("So what?" filtresi).
  if (affectedDows.length < 2) return null;

  const baselineWeekly = grouped.reduce((s, x) => s + x.baselineWeekly, 0);
  const recentWeekly = grouped.reduce((s, x) => s + x.recentWeekly, 0);
  const dropPct = safeDiv(baselineWeekly - recentWeekly, baselineWeekly);
  const estLostRevenue = (baselineWeekly - recentWeekly) * DIP_RECENT_OCC;

  return {
    id: `${m.id}:anomali:ciro_dusus`,
    merchantId: m.id,
    type: "anomali_ciro_dusus",
    severity: dropPct >= 0.5 ? "kritik" : "uyari",
    category: "anomali",
    metrics: {
      affectedDows, // 0=Pazar ... 6=Cumartesi
      hourStart: anchor.hourStart,
      hourEnd: anchor.hourStart + 2,
      baselineWeeklyRevenue: baselineWeekly,
      recentWeeklyRevenue: recentWeekly,
      dropPct,
      estimatedLostRevenue: estLostRevenue,
      recentWeeks: DIP_RECENT_OCC,
    },
    suggestedAction: null, // son müşteriye ulaşma iddiası yok; içgörü P3'e devredilir
    timeframe: tf("son_3_hafta", LAST_DAY_INDEX - 20, LAST_DAY_INDEX),
    confidence: Math.min(1, 0.55 + dropPct / 2),
  };
}

// --- (b) Red oranı artışı --------------------------------------------------

function declineSpikeFinding(
  m: Merchant,
  txs: Transaction[],
  mx: MerchantMetrics,
): Finding | null {
  const recentStart = LAST_DAY_INDEX - 3; // son 4 gün
  const baseLo = LAST_DAY_INDEX - 31;
  const baseHi = LAST_DAY_INDEX - 8;

  let recentTotal = 0;
  let recentDeclined = 0;
  let baseTotal = 0;
  let baseDeclined = 0;
  const bankDeclines = new Map<string, number>();
  const reasonDeclines = new Map<DeclineReason, number>();
  let recentDeclinedAmountApprox = 0;

  for (const tx of txs) {
    const d = dayIndexOfTs(tx.timestamp);
    if (d >= recentStart) {
      recentTotal++;
      if (tx.status === "declined") {
        recentDeclined++;
        recentDeclinedAmountApprox += mx.avgTicket;
        bankDeclines.set(tx.issuerBank, (bankDeclines.get(tx.issuerBank) ?? 0) + 1);
        if (tx.declineReason) {
          reasonDeclines.set(
            tx.declineReason,
            (reasonDeclines.get(tx.declineReason) ?? 0) + 1,
          );
        }
      }
    } else if (d >= baseLo && d <= baseHi) {
      baseTotal++;
      if (tx.status === "declined") baseDeclined++;
    }
  }

  const recentRate = safeDiv(recentDeclined, recentTotal);
  const baseRate = safeDiv(baseDeclined, baseTotal);
  if (recentTotal < DECLINE_MIN_TX || !isRateSpike(baseRate, recentRate)) return null;

  // Tek banka yoğunlaşması
  let topBank = "";
  let topBankCount = 0;
  for (const [bank, c] of bankDeclines.entries()) {
    if (c > topBankCount) {
      topBank = bank;
      topBankCount = c;
    }
  }
  const topBankShare = safeDiv(topBankCount, recentDeclined);

  // Baskın hata kodu
  let topReason: DeclineReason | "" = "";
  let topReasonCount = 0;
  for (const [reason, c] of reasonDeclines.entries()) {
    if (c > topReasonCount) {
      topReason = reason;
      topReasonCount = c;
    }
  }
  const topReasonShare = safeDiv(topReasonCount, recentDeclined);

  // Şiddet: tek banka/teknik yoğunlaşması veya yüksek oran → kritik; dağınık
  // hafif artış → uyari (planlı "teknik arıza" senaryosu net biçimde öne çıkar).
  const severity =
    topBankShare >= 0.4 || recentRate >= 0.15 || topReason === "teknik"
      ? "kritik"
      : "uyari";

  return {
    id: `${m.id}:anomali:red_artis`,
    merchantId: m.id,
    type: "anomali_red_artis",
    severity,
    category: "anomali",
    metrics: {
      baselineDeclineRate: baseRate,
      recentDeclineRate: recentRate,
      rateDeltaPct: safeDiv(recentRate - baseRate, baseRate),
      recentDeclinedCount: recentDeclined,
      recentTotal,
      topBank,
      topBankShare,
      topDeclineReason: topReason,
      topReasonShare,
      estimatedLostRevenue: recentDeclinedAmountApprox,
    },
    // Teknik/tek banka yoğunlaşması → Moka'ya otomatik destek kaydı (Aşama 2)
    suggestedAction: {
      type: "destek_kaydi_olustur",
      mokaProduct: null,
      rationale:
        `Son 4 günde red oranı %${(baseRate * 100).toFixed(1)} bazından ` +
        `%${(recentRate * 100).toFixed(1)}'e çıktı; reddedilen işlemlerin ` +
        `%${(topBankShare * 100).toFixed(0)}'ı ${topBank} kartlarında ` +
        `(${topReason}). Issuer/teknik kaynaklı olması muhtemel — destek kaydı açılmalı.`,
    },
    timeframe: tf("son_4_gun", recentStart, LAST_DAY_INDEX),
    confidence: Math.min(1, 0.6 + topBankShare / 3),
  };
}

// --- (c) İade anomalisi ----------------------------------------------------

const REFUND_BAND_WIDTH = 150;

function refundSpikeFinding(m: Merchant, txs: Transaction[]): Finding | null {
  const recentLo = LAST_DAY_INDEX - 24; // son ~3.5 hafta
  const baseHi = LAST_DAY_INDEX - 30;

  let recentApproved = 0;
  let recentRefunded = 0;
  let baseApproved = 0;
  let baseRefunded = 0;
  let recentRefundedAmount = 0;
  const bandRefunds = new Map<number, number>(); // bin başlangıcı -> iade sayısı
  const bandApproved = new Map<number, number>();

  for (const tx of txs) {
    if (tx.status !== "approved") continue;
    const d = dayIndexOfTs(tx.timestamp);
    const bin = Math.floor(tx.amount / REFUND_BAND_WIDTH) * REFUND_BAND_WIDTH;
    if (d >= recentLo) {
      recentApproved++;
      bandApproved.set(bin, (bandApproved.get(bin) ?? 0) + 1);
      if (tx.refunded) {
        recentRefunded++;
        recentRefundedAmount += tx.amount;
        bandRefunds.set(bin, (bandRefunds.get(bin) ?? 0) + 1);
      }
    } else if (d <= baseHi) {
      baseApproved++;
      if (tx.refunded) baseRefunded++;
    }
  }

  const recentRate = safeDiv(recentRefunded, recentApproved);
  const baseRate = safeDiv(baseRefunded, baseApproved);

  // Fiyat bandı yoğunlaşması: en çok iade alan bin
  let peakBin = -1;
  let peakBinRefunds = 0;
  for (const [bin, c] of bandRefunds.entries()) {
    if (c > peakBinRefunds) {
      peakBin = bin;
      peakBinRefunds = c;
    }
  }
  const peakBandRate =
    peakBin >= 0 ? safeDiv(peakBinRefunds, bandApproved.get(peakBin) ?? 0) : 0;

  const overallSpike = recentRate >= baseRate * 1.3 && recentRate >= 0.04;
  const bandSpike = peakBandRate >= 0.09 && peakBinRefunds >= 5;
  if (!overallSpike && !bandSpike) return null;

  return {
    id: `${m.id}:anomali:iade_artis`,
    merchantId: m.id,
    type: "anomali_iade_artis",
    severity: bandSpike ? "kritik" : "uyari",
    category: "anomali",
    metrics: {
      baselineRefundRate: baseRate,
      recentRefundRate: recentRate,
      rateDeltaPct: safeDiv(recentRate - baseRate, baseRate),
      recentRefundedCount: recentRefunded,
      estimatedRefundedAmount: recentRefundedAmount,
      concentratedBandLow: peakBin,
      concentratedBandHigh: peakBin >= 0 ? peakBin + REFUND_BAND_WIDTH : 0,
      concentratedBandRefundRate: peakBandRate,
      concentratedBandRefunds: peakBinRefunds,
    },
    suggestedAction: null, // operasyonel; ürün/kargo tarafı esnafta → P3 yönlendirir
    timeframe: tf("son_3_hafta", recentLo, LAST_DAY_INDEX),
    confidence: Math.min(1, 0.55 + peakBandRate),
  };
}

export function anomalyFindings(
  m: Merchant,
  txs: Transaction[],
  mx: MerchantMetrics,
): Finding[] {
  const findings: Finding[] = [];
  const dip = revenueDipFinding(m, txs);
  if (dip) findings.push(dip);
  const decline = declineSpikeFinding(m, txs, mx);
  if (decline) findings.push(decline);
  const refund = refundSpikeFinding(m, txs);
  if (refund) findings.push(refund);
  return findings;
}
