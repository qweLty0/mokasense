// Bulgu üreticisi #2 — Anonim sektör/semt benchmark'ı.
// Benchmark değeri (veri havuzu deseni): kıyas SADECE Moka'nın toplu
// verisiyle mümkündür. Percentile GERÇEKTEN havuzdan hesaplanır; çıktı asla
// başka işyerini ifşa etmez (yalnız agrega: peerCount, medyan, percentile).

import type { Merchant } from "../types";
import type {
  BenchmarkPool,
  Finding,
  MerchantMetrics,
  Severity,
} from "./types";
import { LAST_DAY_INDEX, median, percentileRank, safeDiv, tf } from "./util";

/** Kıyas grubu seçimi: aynı sektör + aynı semt; grup < 5 ise sektör geneli. */
const MIN_PEER_GROUP = 5;

export function selectPeers(
  target: MerchantMetrics,
  pool: BenchmarkPool,
): { peers: MerchantMetrics[]; basis: "sektor_semt" | "sektor" } {
  const sectorPeers = pool.bySector[target.sector];
  const local = sectorPeers.filter((p) => p.district === target.district);
  if (local.length >= MIN_PEER_GROUP) return { peers: local, basis: "sektor_semt" };
  return { peers: sectorPeers, basis: "sektor" };
}

/** Bir metrik için işyerinin havuzdaki percentile'ı ve medyanı. */
function positionOf(
  peers: MerchantMetrics[],
  pick: (m: MerchantMetrics) => number,
  value: number,
): { percentile: number; peerMedian: number } {
  const values = peers.map(pick);
  return {
    percentile: percentileRank(values, value),
    peerMedian: median(values),
  };
}

export function benchmarkFindings(
  m: Merchant,
  mx: MerchantMetrics,
  pool: BenchmarkPool,
): Finding[] {
  const { peers, basis } = selectPeers(mx, pool);
  // Kendisi hariç anlamlı kıyas için en az 2 komşu gerek
  if (peers.length < 2) return [];

  // Ciro büyümesi: 4 haftalık ortalamaya göre bu haftanın konumu
  const growth = safeDiv(
    mx.thisWeekRevenue - mx.avg4WeekRevenue,
    mx.avg4WeekRevenue,
  );
  const growthPos = positionOf(
    peers,
    (p) => safeDiv(p.thisWeekRevenue - p.avg4WeekRevenue, p.avg4WeekRevenue),
    growth,
  );
  const ticketPos = positionOf(peers, (p) => p.avgTicket, mx.avgTicket);
  const loyaltyPos = positionOf(
    peers,
    (p) => p.repeatCustomerRate,
    mx.repeatCustomerRate,
  );
  const repeatCountPos = positionOf(
    peers,
    (p) => p.repeatCustomers,
    mx.repeatCustomers,
  );

  // Başlık metriği: en güçlü/zayıf konum ciddiyeti belirler
  const bestPct = Math.max(
    growthPos.percentile,
    ticketPos.percentile,
    loyaltyPos.percentile,
  );
  const worstPct = Math.min(growthPos.percentile, loyaltyPos.percentile);
  let severity: Severity = "bilgi";
  if (bestPct >= 75) severity = "firsat";
  if (worstPct <= 25) severity = "uyari";

  const finding: Finding = {
    id: `${m.id}:benchmark:konum`,
    merchantId: m.id,
    type: "benchmark_konum",
    severity,
    category: "benchmark",
    metrics: {
      basis, // "sektor_semt" | "sektor"
      district: mx.district,
      sector: mx.sector,
      peerCount: peers.length,
      // Ciro büyümesi
      revenueGrowth: growth,
      revenueGrowthPercentile: growthPos.percentile,
      revenueGrowthPeerMedian: growthPos.peerMedian,
      // Ortalama fiş
      avgTicket: mx.avgTicket,
      avgTicketPercentile: ticketPos.percentile,
      avgTicketPeerMedian: ticketPos.peerMedian,
      // Sadakat oranı
      repeatCustomerRate: mx.repeatCustomerRate,
      repeatRatePercentile: loyaltyPos.percentile,
      repeatRatePeerMedian: loyaltyPos.peerMedian,
      // Tekrar gelen müşteri sayısı
      repeatCustomers: mx.repeatCustomers,
      repeatCustomersPercentile: repeatCountPos.percentile,
      repeatCustomersPeerMedian: repeatCountPos.peerMedian,
    },
    suggestedAction: null,
    timeframe: tf("bu_hafta", LAST_DAY_INDEX - 6, LAST_DAY_INDEX),
    // Küçük gruplarda güven düşük
    confidence: Math.min(1, 0.4 + peers.length / 20),
  };

  return [finding];
}
