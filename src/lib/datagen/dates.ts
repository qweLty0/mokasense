// Tarih yardımcıları — üretim tamamen UTC tabanlı yürütülür ki yerel saat
// dilimi kaymaları deterministikliği bozmasın.

/** "YYYY-MM-DD" → gün başlangıcı (UTC) epoch ms. */
export function dayEpoch(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

const MS_PER_DAY = 86_400_000;

export interface DayInfo {
  index: number; // aralık başından itibaren 0-tabanlı gün sırası
  dateStr: string; // "YYYY-MM-DD"
  dow: number; // 0=Pazar ... 6=Cumartesi
  dayOfMonth: number; // 1..31
}

/** start–end (dahil) arasındaki tüm günleri döndürür. */
export function eachDay(start: string, end: string): DayInfo[] {
  const startMs = dayEpoch(start);
  const endMs = dayEpoch(end);
  const days: DayInfo[] = [];
  let idx = 0;
  for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
    const d = new Date(ms);
    days.push({
      index: idx++,
      dateStr: d.toISOString().slice(0, 10),
      dow: d.getUTCDay(),
      dayOfMonth: d.getUTCDate(),
    });
  }
  return days;
}

/** Toplam gün sayısı (dahil). */
export function totalDays(start: string, end: string): number {
  return Math.round((dayEpoch(end) - dayEpoch(start)) / MS_PER_DAY) + 1;
}

/** Bir tarihin ait olduğu haftanın Pazartesi başlangıcı ("YYYY-MM-DD"). */
export function weekStartOf(dateStr: string): string {
  const ms = dayEpoch(dateStr);
  const dow = new Date(ms).getUTCDay(); // 0=Paz
  const deltaToMonday = (dow + 6) % 7; // Pazartesi'ye geri sayım
  return new Date(ms - deltaToMonday * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Maaş günü çarpanı: ayın 1-5 ve 15-18'i arası ciro/işlem yoğunluğu artar. */
export function paydayMultiplier(dayOfMonth: number): number {
  if (dayOfMonth >= 1 && dayOfMonth <= 5) return 1.28;
  if (dayOfMonth >= 15 && dayOfMonth <= 18) return 1.22;
  return 1.0;
}
