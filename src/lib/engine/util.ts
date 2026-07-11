// Motor genel yardımcıları: zaman ekseni (dayIndex) ve saf istatistik fonksiyonları.
// Tüm hesap deterministik; hiçbir dış duruma bağlı değil.

import { DATE_START, DATE_END } from "../datagen/config";
import type { Timeframe } from "./types";

export const MS_PER_DAY = 86_400_000;

/** "YYYY-MM-DD" → gün başlangıcı (UTC) epoch ms. */
export function dayEpoch(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

export const START_MS = dayEpoch(DATE_START);
export const END_MS = dayEpoch(DATE_END);
/** Toplam gün sayısı (dahil). */
export const TOTAL_DAYS = Math.round((END_MS - START_MS) / MS_PER_DAY) + 1;
/** "Şimdi" çıpası — verinin son günü (analiz bu güne göre yapılır). */
export const LAST_DAY_INDEX = TOTAL_DAYS - 1;
export const NOW_DATE = DATE_END;

/** dayIndex → "YYYY-MM-DD". */
export function dateOfIndex(i: number): string {
  return new Date(START_MS + i * MS_PER_DAY).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → dayIndex (aralık başından). */
export function indexOfDate(dateStr: string): number {
  return Math.round((dayEpoch(dateStr) - START_MS) / MS_PER_DAY);
}

/** ISO timestamp → dayIndex (yerel gün, timestamp'in tarih kısmından). */
export function dayIndexOfTs(ts: string): number {
  return indexOfDate(ts.slice(0, 10));
}

/** ISO timestamp → saat (0-23, yerel). */
export function hourOfTs(ts: string): number {
  return Number(ts.slice(11, 13));
}

/** dayIndex → haftanın günü (0=Pazar ... 6=Cumartesi). */
export function dowOfIndex(i: number): number {
  return new Date(START_MS + i * MS_PER_DAY).getUTCDay();
}

/** Bir tarihin ait olduğu haftanın Pazartesi başlangıcı. */
export function weekStartOf(dateStr: string): string {
  const ms = dayEpoch(dateStr);
  const dow = new Date(ms).getUTCDay();
  const deltaToMonday = (dow + 6) % 7;
  return new Date(ms - deltaToMonday * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Timeframe kısayolu (gün indeksleriyle). */
export function tf(label: string, startIdx: number, endIdx: number): Timeframe {
  return {
    label,
    start: dateOfIndex(Math.max(0, startIdx)),
    end: dateOfIndex(Math.min(LAST_DAY_INDEX, endIdx)),
  };
}

// --- Saf istatistik --------------------------------------------------------

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

/** Medyan (girdi kopyalanıp sıralanır; girdi bozulmaz). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
}

/**
 * Bir değerin bir dağılım içindeki yüzdelik konumu (0..100).
 * Yüksek = grubun üstünde. rank = (değeri <= olan eleman sayısı) / n * 100.
 */
export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 50;
  let leq = 0;
  for (const v of values) if (v <= value) leq++;
  return (leq / values.length) * 100;
}

/** Bir dizideki indeksleri toplar (dayIndex aralığı için). */
export function sumRange(arr: number[], startIdx: number, endIdx: number): number {
  let s = 0;
  const lo = Math.max(0, startIdx);
  const hi = Math.min(arr.length - 1, endIdx);
  for (let i = lo; i <= hi; i++) s += arr[i];
  return s;
}

/** Güvenli bölme (payda 0 → 0). */
export function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}
