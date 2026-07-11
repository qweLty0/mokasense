// Analiz Motoru — çıktı tipleri (Finding) ve dahili agrega tipleri.
// MİMARİ KURAL: Bu katman %100 deterministik, SIFIR AI.
// Finding'ler makine-okunur; sayılar HAM (yuvarlanmamış) durur. Formatlama ve
// esnaf-dili mesaj P3 (Dil Katmanı) işidir; motor metin/mesaj YAZMAZ.

import type { Channel, Sector } from "../types";

/** Bulgu ciddiyeti (renk/öncelik sinyali). */
export type Severity = "bilgi" | "firsat" | "uyari" | "kritik";

/** Bulgu kategorisi (hangi üretici çıkardı). */
export type Category =
  | "ozet"
  | "benchmark"
  | "sadakat"
  | "anomali"
  | "hakedis"
  | "capraz_satis";

/** Metrik değeri: sadece olgusal/sayısal veriler (serbest metin YOK). */
export type MetricValue = number | string | boolean | number[] | Record<string, number>;

/**
 * Önerilen aksiyon. P4 aksiyon katmanı `type`'ı yorumlar; `rationale` "neden
 * şimdi, neden sen" olgusal gerekçesidir (esnaf-dili mesaj DEĞİL — P3 stilize eder).
 */
export interface SuggestedAction {
  type: string;
  mokaProduct: string | null;
  rationale: string;
}

/** Bulgunun kapsadığı zaman aralığı. */
export interface Timeframe {
  label: string; // ör. "bu_hafta", "son_4_gun", "son_3_hafta"
  start: string; // ISO gün "YYYY-MM-DD"
  end: string; // ISO gün "YYYY-MM-DD"
}

/** Motorun ürettiği tek yapılandırılmış bulgu. */
export interface Finding {
  id: string;
  merchantId: string;
  type: string;
  severity: Severity;
  category: Category;
  /** Ham olgusal değerler — YUVARLANMAMIŞ. P3 formatlar. */
  metrics: Record<string, MetricValue>;
  suggestedAction: SuggestedAction | null;
  timeframe: Timeframe;
  /** 0..1 — veri hacmi + sapma büyüklüğüne dayalı güven. */
  confidence: number;
}

// --- Dahili agregalar (üreticiler arası paylaşılır) ------------------------

/** Bir haftaya ait toplam. */
export interface WeekPoint {
  weekStart: string;
  revenue: number;
  count: number;
}

/**
 * Bir işyerinin TEK GEÇİŞTE hesaplanan tüm çekirdek metrikleri.
 * PERFORMANS KURALI: ham işlemler bir kez okunur → bu agrega üretilir →
 * runtime bunu (veya Finding'leri) okur, 132MB'ı değil.
 */
export interface MerchantMetrics {
  merchantId: string;
  sector: Sector;
  district: string;

  // Hacim
  txCount: number;
  approvedCount: number;
  declinedCount: number;
  refundedCount: number;
  netRevenue: number; // onaylı & iade edilmemiş toplam tutar
  avgTicket: number; // netRevenue / onaylı-iadesiz adet

  // Oranlar
  declineRate: number;
  refundRate: number;
  foreignRate: number;
  installmentShare: number; // onaylı işlemlerde taksitli (>1) payı
  contactlessShare: number;
  channelShare: Record<Channel, number>;
  channelCounts: Record<Channel, number>;

  // Zaman serileri (dayIndex tabanlı, 0..LAST_DAY_INDEX)
  dailyRevenue: number[];
  dailyCount: number[];
  weekly: WeekPoint[];
  hourRevenue: number[]; // uzunluk 24
  dowRevenue: number[]; // uzunluk 7 (0=Pazar)
  dowCount: number[]; // uzunluk 7

  // Pencere agregaları (NOW = son gün, kayan 7 gün)
  thisWeekRevenue: number;
  lastWeekRevenue: number;
  avg4WeekRevenue: number;
  thisWeekCount: number;
  avgTicketThisWeek: number;
  avgTicketPrev: number;

  // Yoğunluk
  busiestDow: number;
  busiestHour: number;
  busiestBlock: { start: number; end: number; revenue: number };

  // Sadakat
  distinctCustomers: number;
  repeatCustomers: number;
  repeatCustomerRate: number;
  avgVisitsPerCustomer: number;
  medianReturnCycleDays: number | null;
  lostLoyalCount: number; // kayıp yerleşik sadık müşteri sayısı (akran kıyası için)

  // Yabancı kart (çapraz satış için son dönem vs baz)
  foreignRateRecent: number; // son ~30 gün
  foreignRateBaseline: number; // önceki dönem
}

/** Benchmark havuzu: tüm işyerlerinin metrikleri (percentile için). */
export interface BenchmarkPool {
  all: MerchantMetrics[];
  bySector: Record<Sector, MerchantMetrics[]>;
}
