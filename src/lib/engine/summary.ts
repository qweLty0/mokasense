// Bulgu üreticisi #1 — Haftalık/dönemsel özet.
// Ciro trendi, en yoğun gün/saat, işlem sayısı, ortalama fiş, kanal & taksit.
// Saf fonksiyon: MerchantMetrics'ten türetir, ham sayı üretir (metin YAZMAZ).

import type { Merchant } from "../types";
import type { Finding, MerchantMetrics, Severity } from "./types";
import { LAST_DAY_INDEX, safeDiv, tf } from "./util";

export function summaryFindings(m: Merchant, mx: MerchantMetrics): Finding[] {
  // Trend: bu hafta vs geçen hafta ve 4 hafta ortalaması
  const wow = safeDiv(mx.thisWeekRevenue - mx.lastWeekRevenue, mx.lastWeekRevenue);
  const vsAvg = safeDiv(mx.thisWeekRevenue - mx.avg4WeekRevenue, mx.avg4WeekRevenue);
  const trendDir = wow > 0.03 ? "yukari" : wow < -0.03 ? "asagi" : "yatay";

  // Ortalama fiş değişimi (bu hafta vs önceki 3 hafta)
  const ticketChange = safeDiv(
    mx.avgTicketThisWeek - mx.avgTicketPrev,
    mx.avgTicketPrev,
  );

  // Ciddiyet: belirgin düşüş uyarı, belirgin yükseliş fırsat
  let severity: Severity = "bilgi";
  if (wow <= -0.15 || vsAvg <= -0.15) severity = "uyari";
  else if (wow >= 0.15 && vsAvg >= 0.1) severity = "firsat";

  const finding: Finding = {
    id: `${m.id}:ozet:haftalik`,
    merchantId: m.id,
    type: "haftalik_ozet",
    severity,
    category: "ozet",
    metrics: {
      thisWeekRevenue: mx.thisWeekRevenue,
      lastWeekRevenue: mx.lastWeekRevenue,
      avg4WeekRevenue: mx.avg4WeekRevenue,
      weekOverWeekChange: wow,
      vsFourWeekAvgChange: vsAvg,
      trendDirection: trendDir,
      thisWeekCount: mx.thisWeekCount,
      avgTicket: mx.avgTicket,
      avgTicketThisWeek: mx.avgTicketThisWeek,
      avgTicketChange: ticketChange,
      busiestDow: mx.busiestDow,
      busiestHour: mx.busiestHour,
      busiestBlockStart: mx.busiestBlock.start,
      busiestBlockEnd: mx.busiestBlock.end,
      busiestBlockRevenue: mx.busiestBlock.revenue,
      channelShare: mx.channelShare,
      installmentShare: mx.installmentShare,
      contactlessShare: mx.contactlessShare,
    },
    suggestedAction: null,
    timeframe: tf("bu_hafta", LAST_DAY_INDEX - 6, LAST_DAY_INDEX),
    // Güven: bu haftaki işlem hacmi yeterliyse yüksek
    confidence: Math.min(1, 0.5 + mx.thisWeekCount / 200),
  };

  return [finding];
}
