// Analiz Motoru — İşlem raporu / dönem özeti / iade adayı (P4-C).
//
// MİMARİ KURAL: Bu katman %100 deterministik, SIFIR AI.
// "Panel-eşdeğeri" komutların (işlem dökümü, muhasebe özeti, iade) sayısal
// çekirdeği BURADA hesaplanır; client.ts yalnızca esnaf-dostu metne çevirir,
// Dil Katmanı yalnızca sohbette bağlam olarak kullanır. Hesabı AI YAPMAZ.

import type { Channel, DeclineReason, Transaction } from "../types";
import { NOW_DATE, dayEpoch, MS_PER_DAY, safeDiv } from "./util";

// --- Ortak yardımcılar -----------------------------------------------------

const AY_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const emptyChannels = (): Record<Channel, number> => ({ magaza: 0, online: 0, telefon: 0 });

const dateOf = (tx: Transaction) => tx.timestamp.slice(0, 10);
const isNetSale = (tx: Transaction) => tx.status === "approved" && !tx.refunded;

// --- İşlem raporu (panel: işlem inceleme + Excel dökümü) -------------------

export type ReportPeriod = "bugun" | "dun" | "bu_hafta";

export interface TransactionReport {
  period: ReportPeriod;
  label: string; // "bugün", "dün", "bu hafta (son 7 gün)"
  start: string; // "YYYY-MM-DD"
  end: string;
  netCiro: number; // onaylı & iade edilmemiş toplam tutar
  islemSayisi: number; // onaylı & iade edilmemiş işlem adedi
  toplamGirisim: number; // tüm denemeler (onaylı + reddedilen)
  reddedilen: number;
  enBuyukIslem: number;
  ortalamaFis: number;
  kanalDagilimi: Record<Channel, number>; // kanal bazında net ciro
  redSebepleri: Partial<Record<DeclineReason, number>>;
}

/** Rapor döneminin gün sınırlarını "şimdi" çıpasına (NOW_DATE) göre üretir. */
export function periodBounds(period: ReportPeriod): { start: string; end: string; label: string } {
  const nowMs = dayEpoch(NOW_DATE);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  switch (period) {
    case "dun": {
      const d = iso(nowMs - MS_PER_DAY);
      return { start: d, end: d, label: "dün" };
    }
    case "bu_hafta":
      return { start: iso(nowMs - 6 * MS_PER_DAY), end: NOW_DATE, label: "bu hafta (son 7 gün)" };
    case "bugun":
    default:
      return { start: NOW_DATE, end: NOW_DATE, label: "bugün" };
  }
}

/** Bir dönemin işlem dökümünü hesaplar (deterministik). */
export function transactionReport(txs: Transaction[], period: ReportPeriod = "bugun"): TransactionReport {
  const { start, end, label } = periodBounds(period);
  const inRange = (tx: Transaction) => {
    const d = dateOf(tx);
    return d >= start && d <= end;
  };

  const kanalDagilimi = emptyChannels();
  const redSebepleri: Partial<Record<DeclineReason, number>> = {};
  let netCiro = 0;
  let islemSayisi = 0;
  let toplamGirisim = 0;
  let reddedilen = 0;
  let enBuyukIslem = 0;

  for (const tx of txs) {
    if (!inRange(tx)) continue;
    toplamGirisim++;
    if (tx.status === "declined") {
      reddedilen++;
      const r = tx.declineReason;
      if (r) redSebepleri[r] = (redSebepleri[r] ?? 0) + 1;
      continue;
    }
    if (isNetSale(tx)) {
      netCiro += tx.amount;
      islemSayisi++;
      kanalDagilimi[tx.channel] += tx.amount;
      if (tx.amount > enBuyukIslem) enBuyukIslem = tx.amount;
    }
  }

  return {
    period,
    label,
    start,
    end,
    netCiro,
    islemSayisi,
    toplamGirisim,
    reddedilen,
    enBuyukIslem,
    ortalamaFis: safeDiv(netCiro, islemSayisi),
    kanalDagilimi,
    redSebepleri,
  };
}

// --- Dönem/muhasebe özeti (panel: ay dökümü + iade) ------------------------

export interface PeriodSummary {
  month: string; // "YYYY-MM"
  label: string; // "Haziran 2026"
  netCiro: number; // brüt - iade
  brutCiro: number; // onaylı toplam (iade edilenler dahil)
  iadeTutari: number;
  iadeSayisi: number;
  islemSayisi: number; // onaylı işlem adedi (iade dahil)
  ortalamaFis: number;
  kanalDagilimi: Record<Channel, number>; // net ciro kanal bazında
  taksitliPayi: number; // onaylı işlemlerde taksitli (>1) oranı
}

/** NOW ayının bir öncesi (kapanmış ay) — muhasebe özeti için mantıklı vars. */
export function defaultAccountingMonth(): string {
  const d = new Date(dayEpoch(NOW_DATE));
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return `${AY_TR[idx] ?? m} ${y}`;
}

/** Bir ayın muhasebe özetini hesaplar (deterministik). month = "YYYY-MM". */
export function periodSummary(txs: Transaction[], month?: string): PeriodSummary {
  const mon = month ?? defaultAccountingMonth();
  const kanalDagilimi = emptyChannels();
  let brutCiro = 0;
  let netCiro = 0;
  let iadeTutari = 0;
  let iadeSayisi = 0;
  let islemSayisi = 0;
  let taksitli = 0;

  for (const tx of txs) {
    if (tx.status !== "approved") continue;
    if (dateOf(tx).slice(0, 7) !== mon) continue;
    islemSayisi++;
    brutCiro += tx.amount;
    if (tx.installments > 1) taksitli++;
    if (tx.refunded) {
      iadeSayisi++;
      iadeTutari += tx.amount;
    } else {
      netCiro += tx.amount;
      kanalDagilimi[tx.channel] += tx.amount;
    }
  }

  return {
    month: mon,
    label: monthLabel(mon),
    netCiro,
    brutCiro,
    iadeTutari,
    iadeSayisi,
    islemSayisi,
    ortalamaFis: safeDiv(netCiro, islemSayisi - iadeSayisi),
    kanalDagilimi,
    taksitliPayi: safeDiv(taksitli, islemSayisi),
  };
}

// --- İade adayı (panel: kısmi/tam iade) ------------------------------------

/**
 * İade edilebilecek EN SON işlem: onaylı, henüz iade edilmemiş, tarih/saat en
 * yeni olan. "Son çektiğimi geri al" niyeti bunu hedefler. Yoksa null.
 */
export function lastRefundableTransaction(txs: Transaction[]): Transaction | null {
  let best: Transaction | null = null;
  for (const tx of txs) {
    if (!isNetSale(tx)) continue;
    if (!best || tx.timestamp > best.timestamp) best = tx;
  }
  return best;
}

// --- Son dönem red analizi (panel: ret sebebi görme) -----------------------

export interface DeclineBreakdown {
  gunSayisi: number;
  start: string;
  end: string;
  toplamGirisim: number;
  toplamRed: number;
  redOrani: number;
  sebepler: Partial<Record<DeclineReason, number>>;
  enSikSebep: DeclineReason | null;
}

/** Son `days` günün red dökümü — "kartım neden geçmedi" için olgusal zemin. */
export function recentDeclineBreakdown(txs: Transaction[], days = 14): DeclineBreakdown {
  const nowMs = dayEpoch(NOW_DATE);
  const start = new Date(nowMs - (days - 1) * MS_PER_DAY).toISOString().slice(0, 10);
  const end = NOW_DATE;

  const sebepler: Partial<Record<DeclineReason, number>> = {};
  let toplamGirisim = 0;
  let toplamRed = 0;

  for (const tx of txs) {
    const d = dateOf(tx);
    if (d < start || d > end) continue;
    toplamGirisim++;
    if (tx.status === "declined") {
      toplamRed++;
      const r = tx.declineReason;
      if (r) sebepler[r] = (sebepler[r] ?? 0) + 1;
    }
  }

  let enSikSebep: DeclineReason | null = null;
  let max = 0;
  for (const [k, v] of Object.entries(sebepler) as [DeclineReason, number][]) {
    if (v > max) {
      max = v;
      enSikSebep = k;
    }
  }

  return {
    gunSayisi: days,
    start,
    end,
    toplamGirisim,
    toplamRed,
    redOrani: safeDiv(toplamRed, toplamGirisim),
    sebepler,
    enSikSebep,
  };
}
