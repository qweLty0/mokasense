// Moka Yönetici Paneli — agrega katmanı (P4-B).
//
// GERÇEKLİK KURALI: Tüm KPI'lar 50 işyerinin ÖNCEDEN HESAPLANMIŞ bulgularından
// (insights) gerçekten agrega edilir; uydurma sabit yoktur. Projeksiyonlar
// (ör. aylık hacim, fırsat hacmi) açık varsayımlarla ve gerçek metriklerden
// türetilir — hangi sinyalden geldiği koddan izlenebilir.
//
// Yalnızca sunucu tarafı (fs). /chat ve backend'e dokunmaz; sadece okur.

import { loadFindings, loadInsightsIndex, loadMerchants } from "../data";
import type { Finding, Severity } from "../engine/types";
import type { Sector } from "../types";

// Bir haftalık ciroyu tahmini aya çevirme katsayısı (52/12 ≈ 4.33).
const WEEKS_PER_MONTH = 4.33;

const SEVERITY_ORDER: Record<Severity, number> = {
  bilgi: 0,
  firsat: 1,
  uyari: 2,
  kritik: 3,
};

export const SECTOR_TR: Record<Sector, string> = {
  kasap: "Kasap",
  kafe: "Kafe",
  kuafor: "Kuaför",
  eticaret: "E-ticaret",
};

/** Bir finding'in kısa Türkçe başlığı (admin görünümü). */
export const FINDING_TITLE: Record<string, string> = {
  haftalik_ozet: "Haftalık özet",
  benchmark_konum: "Semt/sektör kıyası",
  sadakat_ozet: "Sadakat analizi",
  sadakat_kayip: "Kayıp sadık müşteri",
  hakedis_net: "Hakediş (net)",
  anomali_ciro_dusus: "Ciro düşüşü (anomali)",
  anomali_red_artis: "Red oranı artışı (anomali)",
  anomali_iade_artis: "İade artışı (anomali)",
  capraz_satis_odeme_linki: "Çapraz satış · Ödeme Linki",
  capraz_satis_taksit: "Çapraz satış · Taksit",
  capraz_satis_dovizli: "Çapraz satış · Dövizli Ödeme",
  capraz_satis_ek_terminal: "Çapraz satış · Ek Terminal",
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Bir bulgunun tek satır olgusal özeti (admin detay görünümü). */
export function describeFinding(f: Finding): string {
  const m = f.metrics;
  const pct = (v: unknown) => `%${Math.round(num(v) * 100)}`;
  const tl = (v: unknown) => `${Math.round(num(v)).toLocaleString("tr-TR")} TL`;
  switch (f.type) {
    case "haftalik_ozet":
      return `Bu hafta ${tl(m.thisWeekRevenue)} ciro, geçen haftaya göre ${pct(m.weekOverWeekChange)} değişim.`;
    case "benchmark_konum":
      return `Ciro büyümesinde semt/sektör akranları arasında ${Math.round(num(m.revenueGrowthPercentile) * 100)}. yüzdelik dilimde (${num(m.peerCount)} akran).`;
    case "sadakat_ozet":
      return `Tekrar müşteri oranı ${pct(m.repeatCustomerRate)}; ${num(m.repeatCustomers)} müdavim, ort. dönüş ${m.medianReturnCycleDays ?? "—"} gün.`;
    case "sadakat_kayip":
      return `${num(m.lostCount)} yerleşik müdavim döngüsünü kırdı; tahmini kayıp ${tl(m.estimatedLostRevenue)}.`;
    case "hakedis_net":
      return `Yarın net ${tl(m.netTomorrow)} (valör ${m.valueDate}); ay sonu tahmini ${tl(m.projectedMonthEndNet)}.`;
    case "anomali_ciro_dusus":
      return `${(m.affectedDows as number[] | undefined)?.length ?? 0} günde ${num(m.hourStart)}:00-${num(m.hourEnd)}:00 dilimi %${Math.round(num(m.dropPct) * 100)} düştü; tahmini kayıp ${tl(m.estimatedLostRevenue)}.`;
    case "anomali_red_artis":
      return `Red oranı ${pct(m.baselineDeclineRate)}→${pct(m.recentDeclineRate)} (${m.topBank}, ${m.topDeclineReason}); tahmini kayıp ${tl(m.estimatedLostRevenue)}.`;
    case "anomali_iade_artis":
      return `İade oranı ${pct(m.baselineRefundRate)}→${pct(m.recentRefundRate)}; ${tl(m.concentratedBandLow)}-${tl(m.concentratedBandHigh)} bandında yoğun.`;
    case "capraz_satis_odeme_linki":
      return `Telefon siparişi payı ${pct(m.phoneChannelShare)} — ödeme linkiyle tahsilat kolaylaşır.`;
    case "capraz_satis_taksit":
      return `Ortalama fiş ${tl(m.avgTicket)}, taksit payı ${pct(m.installmentShare)} — taksit satışı büyütür.`;
    case "capraz_satis_dovizli":
      return `Yabancı kart oranı ${pct(m.foreignRateBaseline)}→${pct(m.foreignRateRecent)} yükselişte — dövizli ödeme fırsatı.`;
    case "capraz_satis_ek_terminal":
      return `En yoğun gün ortalamanın ${num(m.peakRatio).toFixed(1)}× üstünde — ek terminal kuyruğu azaltır.`;
    default:
      return f.type;
  }
}

// --- Dışa açılan tipler ----------------------------------------------------

export interface AdminFinding {
  id: string;
  type: string;
  title: string;
  severity: Severity;
  category: string;
  mokaProduct: string | null;
  actionType: string | null;
  rationale: string | null;
  detail: string;
}

export interface AdminMerchantRow {
  merchantId: string;
  name: string;
  sector: Sector;
  sectorTr: string;
  district: string;
  weekRevenue: number;
  findingCount: number;
  topSeverity: Severity;
  crossSellProducts: string[];
  churnRisk: boolean;
  preventedLoss: number;
  findings: AdminFinding[];
}

export interface CrossSellSlice {
  product: string;
  count: number;
}

export interface AdminAggregate {
  generatedAt: string;
  merchantCount: number;
  // KPI 1 — hacim
  totalWeekRevenue: number;
  estMonthlyVolume: number;
  opportunityVolume: number;
  // KPI 2 — çapraz satış hunisi
  crossSellTotal: number;
  crossSellAccepted: number; // öneri güven skoruna göre tahmini
  crossSellAcceptanceRate: number;
  crossSellByProduct: CrossSellSlice[];
  // KPI 3 — churn riski
  churnRiskCount: number;
  // KPI 4 — önlenen kayıp
  preventedLoss: number;
  // KPI 5 — destek yükü azalması (WhatsApp'ta panele/çağrı merkezine girmeden çözülen iş)
  supportResolved: number;
  // Tablo
  rows: AdminMerchantRow[];
}

// Dişli 5 — "destek yükü azalması": esnafın normalde panele girerek veya çağrı
// merkezini arayarak halledeceği, MokaSense'in WhatsApp'ta çözdüğü iş sayısı.
// Her bulgu, esnafın sohbetten karşılığını alabildiği somut bir etkileşimdir:
//   - haftalik_ozet: rapor/döküm (panel + Excel yerine)
//   - hakedis_net: hakediş sorgusu (panel yerine)
//   - anomali_*: teknik sorun tespiti → destek kaydı (çağrı merkezi yerine)
const SUPPORT_RESOLVED_TYPES = new Set([
  "haftalik_ozet",
  "hakedis_net",
  "anomali_ciro_dusus",
  "anomali_red_artis",
  "anomali_iade_artis",
]);

/** 50 işyerinin bulgularından yönetici paneli agregasını üretir. */
export function buildAdminAggregate(): AdminAggregate {
  const index = loadInsightsIndex();
  const merchants = loadMerchants();
  const productById = new Map(merchants.map((m) => [m.id, m]));

  const rows: AdminMerchantRow[] = [];

  let totalWeekRevenue = 0;
  let opportunityVolume = 0;
  let crossSellTotal = 0;
  let crossSellConfidenceSum = 0;
  let churnRiskCount = 0;
  let preventedLoss = 0;
  let supportResolved = 0;
  const productCounts: Record<string, number> = {};

  for (const entry of index.merchants) {
    const findings = loadFindings(entry.merchantId);
    if (findings.length === 0) continue;

    const sector = (productById.get(entry.merchantId)?.sector ?? "kafe") as Sector;

    // Haftalık ciro (özet bulgusundan)
    const summaryF = findings.find((f) => f.type === "haftalik_ozet");
    const weekRevenue = num(summaryF?.metrics.thisWeekRevenue);
    const merchantMonthly = weekRevenue * WEEKS_PER_MONTH;
    totalWeekRevenue += weekRevenue;

    // En yüksek severity
    let topSeverity: Severity = "bilgi";
    for (const f of findings) {
      if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[topSeverity]) topSeverity = f.severity;
    }

    // Önlenen kayıp (anomali tahmini kayıpları)
    let merchantPrevented = 0;
    for (const f of findings) {
      if (f.type === "anomali_ciro_dusus" || f.type === "anomali_red_artis") {
        merchantPrevented += num(f.metrics.estimatedLostRevenue);
      } else if (f.type === "anomali_iade_artis") {
        merchantPrevented += num(f.metrics.estimatedRefundedAmount);
      }
    }
    preventedLoss += merchantPrevented;

    // Çapraz satış + fırsat hacmi (gerçek sinyalden)
    const crossSellProducts: string[] = [];
    for (const f of findings) {
      if (f.category !== "capraz_satis") continue;
      crossSellTotal += 1;
      crossSellConfidenceSum += f.confidence;
      const product = f.suggestedAction?.mokaProduct ?? "Diğer";
      productCounts[product] = (productCounts[product] ?? 0) + 1;
      if (product) crossSellProducts.push(product);
      // Fırsat hacmi: yalnızca hacme bağlanabilen sinyaller (dövizli, telefon→link)
      if (f.type === "capraz_satis_dovizli") {
        opportunityVolume += num(f.metrics.foreignRateRecent) * merchantMonthly;
      } else if (f.type === "capraz_satis_odeme_linki") {
        opportunityVolume += num(f.metrics.phoneChannelShare) * merchantMonthly;
      }
    }

    const churnRisk = findings.some((f) => f.type === "sadakat_kayip");
    if (churnRisk) churnRiskCount += 1;

    // Destek yükü azalması: WhatsApp'ta karşılığı alınabilen bulgular.
    for (const f of findings) {
      if (SUPPORT_RESOLVED_TYPES.has(f.type)) supportResolved += 1;
    }

    const adminFindings: AdminFinding[] = findings.map((f) => ({
      id: f.id,
      type: f.type,
      title: FINDING_TITLE[f.type] ?? f.type,
      severity: f.severity,
      category: f.category,
      mokaProduct: f.suggestedAction?.mokaProduct ?? null,
      actionType: f.suggestedAction?.type ?? null,
      rationale: f.suggestedAction?.rationale ?? null,
      detail: describeFinding(f),
    }));

    rows.push({
      merchantId: entry.merchantId,
      name: entry.name,
      sector,
      sectorTr: SECTOR_TR[sector],
      district: entry.district,
      weekRevenue,
      findingCount: findings.length,
      topSeverity,
      crossSellProducts: Array.from(new Set(crossSellProducts)),
      churnRisk,
      preventedLoss: merchantPrevented,
      findings: adminFindings,
    });
  }

  // Kabul oranı: gerçek "aksiyon logu" henüz yok → öneri GÜVEN skorundan türetilir
  // (yüksek güvenli öneriler aksiyona daha yakın). Açıkça "tahmini" etiketlenir.
  const crossSellAcceptanceRate = crossSellTotal > 0 ? crossSellConfidenceSum / crossSellTotal : 0;
  const crossSellAccepted = Math.round(crossSellTotal * crossSellAcceptanceRate);

  const crossSellByProduct: CrossSellSlice[] = Object.entries(productCounts)
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: index.generatedAt,
    merchantCount: rows.length,
    totalWeekRevenue,
    estMonthlyVolume: totalWeekRevenue * WEEKS_PER_MONTH,
    opportunityVolume,
    crossSellTotal,
    crossSellAccepted,
    crossSellAcceptanceRate,
    crossSellByProduct,
    churnRiskCount,
    preventedLoss,
    supportResolved,
    rows,
  };
}
