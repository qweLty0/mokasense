// Analiz Motoru orchestrator.
// Bir işyeri için tüm üreticileri çalıştırır, Finding[] döndürür, ciddiyete göre
// sıralar. Ham işlemler ÜRETİCİLERE bir kez geçirilir (performans kuralı).

import type { Merchant, Transaction } from "../types";
import type { BenchmarkPool, Finding, MerchantMetrics, Severity } from "./types";
import { computeMerchantMetrics } from "./metrics";
import { summaryFindings } from "./summary";
import { benchmarkFindings } from "./benchmark";
import { loyaltyFindings } from "./loyalty";
import { anomalyFindings } from "./anomaly";
import { settlementFindings } from "./settlement";
import { crosssellFindings } from "./crosssell";

const SEVERITY_RANK: Record<Severity, number> = {
  kritik: 0,
  uyari: 1,
  firsat: 2,
  bilgi: 3,
};

/** Bulguları ciddiyet → güven → kategori sırasına dizer (deterministik). */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Bir işyeri için tüm bulguları üretir. metrics dışarıdan verilebilir (pool
 * kurulumunda zaten hesaplandıysa yeniden hesaplamayı önler).
 */
export function analyzeMerchant(
  merchant: Merchant,
  txs: Transaction[],
  pool: BenchmarkPool,
  metrics?: MerchantMetrics,
): Finding[] {
  const mx = metrics ?? computeMerchantMetrics(merchant, txs);
  const findings: Finding[] = [
    ...summaryFindings(merchant, mx),
    ...benchmarkFindings(merchant, mx, pool),
    ...loyaltyFindings(merchant, txs, mx, pool),
    ...anomalyFindings(merchant, txs, mx),
    ...settlementFindings(merchant, txs),
    ...crosssellFindings(merchant, mx),
  ];
  return sortFindings(findings);
}

export * from "./types";
export { computeMerchantMetrics, buildBenchmarkPool } from "./metrics";
