// Sentetik veri üretimi için sabit konfigürasyon: sektör davranışları, semtler,
// bankalar, isim havuzları. Tüm gerçekçilik parametreleri burada toplanır.

import type { CardSegment, Sector } from "../types";

/** Sabit seed — deterministik üretim (mimari karar). */
export const SEED = 20260712;

/** İşlem geçmişi aralığı: 1 Ocak – 6 Temmuz 2026 (dahil). */
export const DATE_START = "2026-01-01";
export const DATE_END = "2026-07-06";

/** İstanbul'un ana zaman dilimi ofseti (yaz saati, +03:00). */
export const TZ_OFFSET = "+03:00";

/** İşyeri dağılımı (toplam 50). */
export const SECTOR_COUNTS: Record<Sector, number> = {
  kasap: 12,
  kafe: 16,
  kuafor: 10,
  eticaret: 12,
};

/** İstanbul semtleri (fiziksel işyerleri için). */
export const DISTRICTS = [
  "Kadıköy",
  "Beşiktaş",
  "Şişli",
  "Üsküdar",
  "Bakırköy",
  "Beyoğlu",
  "Maltepe",
  "Ataşehir",
  "Fatih",
  "Sarıyer",
  "Kartal",
  "Bahçelievler",
  "Pendik",
  "Ümraniye",
] as const;

/** Kartı basan bankalar (gerçekçi Türk banka dağılımı). */
export const BANKS = [
  "Ziraat Bankası",
  "İş Bankası",
  "Garanti BBVA",
  "Yapı Kredi",
  "Akbank",
  "QNB",
  "DenizBank",
  "Halkbank",
  "VakıfBank",
  "TEB",
] as const;

/** Yabancı kart menşei (turist/yabancı sinyali). */
export const FOREIGN_ISSUERS = [
  "Chase",
  "Barclays",
  "Deutsche Bank",
  "BNP Paribas",
  "Revolut",
  "Sberbank",
] as const;

/** Segment ağırlıkları (çoğunluk classic). */
export const SEGMENTS: CardSegment[] = ["classic", "gold", "platinum", "business"];
export const SEGMENT_WEIGHTS = [62, 24, 8, 6];

/** Sektöre göre davranış profili. */
export interface SectorProfile {
  /** Günün her saati için göreli yoğunluk ağırlığı (0-23). Toplam önemli değil, oran önemli. */
  hourWeights: number[];
  /** Haftanın günleri için çarpan (0=Pazar ... 6=Cumartesi). */
  dowMultiplier: number[];
  /** Ortalama günlük işlem sayısı (hafta içi, normal gün taban). */
  baseDailyTx: number;
  /** Sepet tutarı lognormal parametreleri. */
  basketMedian: number;
  basketSigma: number;
  /** Taksit kullanım olasılığı (yüksek tutarlarda). */
  installmentProb: number;
  /** Temassız ödeme olasılığı. */
  contactlessProb: number;
  /** Taban red oranı. */
  baseDeclineRate: number;
  /** Taban iade oranı. */
  baseRefundRate: number;
  /** Tekrar gelen (sadık) müşteri havuzu büyüklüğü ve döngü haftası. */
  loyalPoolSize: number;
  /** Sadık müşteri geri dönüş döngüsü (hafta cinsinden, aralık). */
  loyalCycleWeeks: [number, number];
  /** Bir işlemin sadık havuzdan gelme olasılığı. */
  loyalShare: number;
  /** POS tipi. */
  posType: "fiziksel" | "sanal";
  /** Baskın kanal. */
  primaryChannel: "magaza" | "online";
  /** Telefon siparişi olasılığı (fiziksel işyerlerinde küçük). */
  phoneOrderProb: number;
}

// Saat ağırlık şablonları -------------------------------------------------

// Kasap: sabah–öğle ağırlıklı, akşamüstü ikinci pik, gece kapalı.
const KASAP_HOURS = [
  0, 0, 0, 0, 0, 0, 0, 2, 6, 9, 10, 10, 8, 6, 6, 7, 8, 9, 7, 3, 1, 0, 0, 0,
];
// Kafe: sabah kahvesi (8-11), öğleden sonra (14-17), akşam sohbeti.
const KAFE_HOURS = [
  0, 0, 0, 0, 0, 0, 1, 4, 8, 9, 8, 7, 7, 8, 9, 9, 8, 7, 6, 6, 5, 3, 1, 0,
];
// Kuaför: randevu bazlı, 10-19, öğleden sonra yoğun.
const KUAFOR_HOURS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 8, 7, 6, 8, 9, 9, 9, 8, 6, 2, 0, 0, 0,
];
// E-ticaret: 7/24 ama akşam (20-23) pik.
const ETICARET_HOURS = [
  3, 2, 1, 1, 1, 1, 2, 3, 4, 5, 5, 5, 6, 6, 6, 6, 7, 8, 9, 10, 10, 9, 7, 5,
];

export const SECTOR_PROFILES: Record<Sector, SectorProfile> = {
  kasap: {
    hourWeights: KASAP_HOURS,
    // Hafta sonu et alışverişi yoğun (Cuma-Cmt).
    dowMultiplier: [0.7, 0.85, 0.9, 0.95, 1.0, 1.25, 1.35],
    baseDailyTx: 32,
    // Hedef işlem-başı ortalama ~1400 TL. Lognormal medyan ortalamadan düşük
    // (sağa çarpık); birleşik çarpan (spend*segment*maaş günü ~1.25) ve
    // exp(σ²/2) ile ölçeklenir. Bant ~300-6000 TL.
    basketMedian: 985,
    basketSigma: 0.5,
    installmentProb: 0.05,
    contactlessProb: 0.55,
    baseDeclineRate: 0.03,
    baseRefundRate: 0.01,
    loyalPoolSize: 120,
    loyalCycleWeeks: [1, 2],
    loyalShare: 0.5,
    posType: "fiziksel",
    primaryChannel: "magaza",
    phoneOrderProb: 0.04,
  },
  kafe: {
    hourWeights: KAFE_HOURS,
    // Hafta sonu ve Cuma daha kalabalık.
    dowMultiplier: [1.15, 0.9, 0.9, 0.95, 1.0, 1.2, 1.3],
    baseDailyTx: 46,
    // Hedef işlem-başı ortalama ~800 TL. Bant ~150-4000 TL.
    basketMedian: 555,
    basketSigma: 0.52,
    installmentProb: 0.01,
    contactlessProb: 0.7,
    baseDeclineRate: 0.025,
    baseRefundRate: 0.008,
    loyalPoolSize: 200,
    loyalCycleWeeks: [1, 1],
    loyalShare: 0.45,
    posType: "fiziksel",
    primaryChannel: "magaza",
    phoneOrderProb: 0.02,
  },
  kuafor: {
    hourWeights: KUAFOR_HOURS,
    // Cumartesi zirvesi, Pazar sakin/kapalı.
    dowMultiplier: [0.5, 0.8, 0.9, 1.0, 1.0, 1.15, 1.5],
    baseDailyTx: 16,
    // Hedef işlem-başı ortalama ~700 TL. Bant ~200-5000 TL.
    basketMedian: 490,
    basketSigma: 0.52,
    installmentProb: 0.08,
    contactlessProb: 0.5,
    baseDeclineRate: 0.02,
    baseRefundRate: 0.005,
    loyalPoolSize: 90,
    loyalCycleWeeks: [4, 6], // kuaför 4-6 hafta döngü
    loyalShare: 0.7,
    posType: "fiziksel",
    primaryChannel: "magaza",
    phoneOrderProb: 0.03,
  },
  eticaret: {
    hourWeights: ETICARET_HOURS,
    // Hafta içi hafif ağırlık (mesai/akşam), hafta sonu biraz düşük.
    dowMultiplier: [0.95, 1.05, 1.05, 1.05, 1.05, 1.0, 0.9],
    baseDailyTx: 55,
    // Hedef işlem-başı ortalama ~900 TL. Bant ~250-5000 TL.
    basketMedian: 600,
    basketSigma: 0.6,
    installmentProb: 0.25,
    contactlessProb: 0, // online, temassız kavramı yok
    baseDeclineRate: 0.06,
    baseRefundRate: 0.03,
    loyalPoolSize: 300,
    loyalCycleWeeks: [2, 5],
    loyalShare: 0.35,
    posType: "sanal",
    primaryChannel: "online",
    phoneOrderProb: 0,
  },
};

// İsim havuzları ----------------------------------------------------------

export const KASAP_NAMES = [
  "Hasan Usta Kasabı",
  "Bereket Et Ürünleri",
  "Anadolu Kasabı",
  "Taze Et Galericisi",
  "Köşe Kasap",
  "Şahin Et",
  "Güven Kasabı",
  "Öztürk Et Pazarı",
  "Demir Kasap",
  "Bolu Et Evi",
  "Has Kasap",
  "Yörük Et Ürünleri",
];

export const KAFE_NAMES = [
  "Kahve Molası",
  "Köşe Kafe",
  "Fincan Kahvecisi",
  "Sokak Arası Coffee",
  "Deniz Manzara Kafe",
  "Çınaraltı Kahvesi",
  "Mola Cafe",
  "Sabah Kahvesi",
  "Nostalji Kafe",
  "Kütüphane Coffee",
  "Bahçe Kafe",
  "Kırık Fincan",
  "Üçüncü Dalga Kahve",
  "Rıhtım Cafe",
  "Kedili Kahve",
  "Yokuş Başı Kafe",
];

export const KUAFOR_NAMES = [
  "Selin Kuaför",
  "Stil Erkek Kuaförü",
  "Makas Güzellik",
  "Ayna Kuaför",
  "Modern Saç Tasarım",
  "Elit Kuaför",
  "Bella Güzellik Salonu",
  "Barber Köşe",
  "Şık Saç Stüdyo",
  "Prestij Kuaför",
];

export const ETICARET_NAMES = [
  "TrendButik Online",
  "EvVeYaşam Store",
  "TeknoDükkan",
  "Doğal Kozmetik Shop",
  "SporcuMarket",
  "Kitap Kurdu Online",
  "Bebek Dünyası",
  "Aksesuar Sepeti",
  "Organik Gıda Pazarı",
  "Pati Dükkanı",
  "Deri Atölye",
  "Hobi Bahçesi",
];

export const SECTOR_NAME_POOLS: Record<Sector, string[]> = {
  kasap: KASAP_NAMES,
  kafe: KAFE_NAMES,
  kuafor: KUAFOR_NAMES,
  eticaret: ETICARET_NAMES,
};

/** Sektöre göre başlangıçta aktif Moka ürünleri (çapraz satış motoru bunun üstüne çalışır). */
export const SECTOR_ACTIVE_PRODUCTS: Record<Sector, string[]> = {
  kasap: ["Fiziksel POS"],
  kafe: ["Fiziksel POS"],
  kuafor: ["Fiziksel POS"],
  eticaret: ["Sanal POS"],
};
