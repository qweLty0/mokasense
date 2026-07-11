// MokaSense — Tüm veri tipleri (tek doğruluk kaynağı).
// mimari karar (Mimari / Veri) ile birebir uyumludur.

/** İşyeri sektörü (MCC çeşitliliği: sadece restoran değil). */
export type Sector = "kasap" | "kafe" | "kuafor" | "eticaret";

/** POS/terminal tipi. e-ticaret için sanal POS. */
export type PosType = "fiziksel" | "sanal";

/** İşlem kanalı. e-ticaret online, diğerleri mağaza içi; telefon siparişi de mümkün. */
export type Channel = "magaza" | "online" | "telefon";

/** Kart tipi. */
export type CardType = "credit" | "debit" | "prepaid";

/** Kartın çıkış menşei. Yabancı kart sinyali için kritik. */
export type CardOrigin = "domestic" | "foreign";

/** Kart segmenti (harcama gücü sinyali). */
export type CardSegment = "classic" | "gold" | "platinum" | "business";

/** İşlem durumu. */
export type TxStatus = "approved" | "declined";

/**
 * Reddedilme sebebi (yalnızca status === "declined" olduğunda dolu).
 * "teknik" kodu anomali senaryosunda (issuer kaynaklı) yoğunlaşır.
 */
export type DeclineReason =
  | "yetersiz_bakiye"
  | "limit_asimi"
  | "teknik"
  | "hatali_sifre"
  | "kart_kayip_calinti"
  | "banka_reddi";

/** İşyeri (esnaf/KOBİ). */
export interface Merchant {
  id: string;
  name: string;
  sector: Sector;
  district: string; // İstanbul semti (ör. "Kadıköy")
  city: string; // "İstanbul"
  posType: PosType;
  signupDate: string; // ISO tarih (kayıt tarihi)
  /** Aktif Moka ürünleri (çapraz satış motoru bunun üstüne çalışır). */
  activeProducts: string[];
  /** Demo/analiz kolaylığı için işaretlenmiş işaretli anomali etiketleri. */
  anomalyTags?: string[];
}

/** Tekil ödeme işlemi. */
export interface Transaction {
  id: string;
  merchantId: string;
  timestamp: string; // ISO 8601, İstanbul yerel saatine göre üretilir
  amount: number; // TL, 2 ondalık
  cardToken: string; // Aynı kart = aynı token (sadakat/tekrar müşteri için)
  cardType: CardType;
  cardOrigin: CardOrigin;
  issuerBank: string; // Kartı basan banka
  cardSegment: CardSegment;
  installments: number; // 1 = tek çekim
  channel: Channel;
  status: TxStatus;
  declineReason: DeclineReason | null;
  refunded: boolean;
  contactless: boolean;
}

/**
 * datagen çıktısının özeti (page.tsx ve doğrulama bu dosyayı okur).
 * Ağır tx dosyalarını okumadan hızlı özet göstermeyi sağlar.
 */
export interface DataSummary {
  generatedAt: string;
  seed: number;
  dateRange: { start: string; end: string };
  merchantCount: number;
  transactionCount: number;
  sectorBreakdown: Record<Sector, { merchants: number; transactions: number }>;
  /** Doğrulama metrikleri (üreteç mantığının çalıştığını gösterir). */
  checks: {
    kafeAvgTicket: number;
    overallDeclineRate: number;
    foreignCardRate: number;
    /** Örnek kafe: Salı-Çarş 14-17 dilimi, son 6 haftanın haftalık cirosu. */
    heroCafe: {
      merchantId: string;
      name: string;
      weeklyTueWedAfternoonRevenue: { weekStart: string; revenue: number }[];
    };
  };
}
