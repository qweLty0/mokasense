// Bulgu üreticisi #3 — Sadakat (cardToken) analizi.
// Tekrar gelen müşteri oranı + sektör kıyası, dönüş döngüsü ve KAYIP SADIK
// MÜŞTERİ tespiti (kuaför anomalisi: normal döngüsünü aşıp dönmeyenler).

import type { Merchant, Transaction } from "../types";
import type { BenchmarkPool, Finding, MerchantMetrics, Severity } from "./types";
import { selectPeers } from "./benchmark";
import { detectLostLoyal } from "./metrics";
import { LAST_DAY_INDEX, median, percentileRank, safeDiv, tf } from "./util";

// Kayıp sadık tespiti metrics.ts'te (metrik havuzuyla ortak). Test/dış kullanım
// için buradan da erişilebilir kalsın.
export { detectLostLoyal } from "./metrics";
export type { LostCustomer } from "./metrics";

/**
 * Bulgu kapıları — kayıp SADECE mutlak eşiği aşınca DEĞİL, AKRAN NORMUNUN da
 * belirgin üstündeyse anomalidir. Bu sayede doğası gereği yüksek devirli
 * sektörlerin (e-ticaret) tabanı elenir; kuaför-01 gibi gerçek aykırı öne çıkar.
 */
const CHURN_MIN_LOST = 5; // taban: en az bu kadar kayıp
const CHURN_PEER_FACTOR = 1.6; // akran medyanının bu katını aşmalı

export function loyaltyFindings(
  m: Merchant,
  txs: Transaction[],
  mx: MerchantMetrics,
  pool: BenchmarkPool,
): Finding[] {
  const findings: Finding[] = [];
  const { peers, basis } = selectPeers(mx, pool);
  const peerRates = peers.map((p) => p.repeatCustomerRate);
  const ratePct = percentileRank(peerRates, mx.repeatCustomerRate);
  const peerMedianRate = median(peerRates);

  // 1) Sadakat özeti
  findings.push({
    id: `${m.id}:sadakat:ozet`,
    merchantId: m.id,
    type: "sadakat_ozet",
    severity: ratePct >= 70 ? "firsat" : "bilgi",
    category: "sadakat",
    metrics: {
      repeatCustomerRate: mx.repeatCustomerRate,
      repeatCustomers: mx.repeatCustomers,
      distinctCustomers: mx.distinctCustomers,
      avgVisitsPerCustomer: mx.avgVisitsPerCustomer,
      medianReturnCycleDays: mx.medianReturnCycleDays ?? 0,
      repeatRatePercentile: ratePct,
      repeatRatePeerMedian: peerMedianRate,
      benchmarkBasis: basis,
      peerCount: peers.length,
    },
    suggestedAction: null,
    timeframe: tf("tum_donem", 0, LAST_DAY_INDEX),
    confidence: Math.min(1, 0.5 + mx.distinctCustomers / 400),
  });

  // 2) Kayıp sadık müşteri tespiti — akran-göreli
  const peerLostMedian = median(peers.map((p) => p.lostLoyalCount));
  const churnThreshold = Math.max(CHURN_MIN_LOST, peerLostMedian * CHURN_PEER_FACTOR);
  const lost = detectLostLoyal(txs);
  if (lost.length >= churnThreshold) {
    const estLostRevenue = lost.reduce((s, c) => s + c.missedVisits * mx.avgTicket, 0);
    const medianSilent = median(lost.map((c) => c.silentDays));
    const medianCycle = median(lost.map((c) => c.cycleDays));
    // Ciddiyet: kayıp sayısı ve ciro etkisi büyükse yükselir
    let severity: Severity = "uyari";
    if (lost.length >= 10 || estLostRevenue > mx.avgTicket * 30) severity = "kritik";

    findings.push({
      id: `${m.id}:sadakat:kayip`,
      merchantId: m.id,
      type: "sadakat_kayip",
      severity,
      category: "sadakat",
      metrics: {
        lostCount: lost.length,
        peerLostMedian,
        estimatedLostRevenue: estLostRevenue,
        medianSilentDays: medianSilent,
        medianCycleDays: medianCycle,
        avgTicket: mx.avgTicket,
      },
      // GERÇEKLİK KURALI: Son müşterinin iletişim bilgisi Moka'da YOK; ona
      // DOĞRUDAN ulaşamayız (ürün kuralı). Bu yüzden soyut "kampanya kur"
      // önermeyiz. SOMUT ve yapılabilir aksiyon: indirimli kampanya/ödeme linki
      // ÜRETMEK (Moka linkle ödeme servisi) — esnaf bu linki KENDİ kanalından
      // (Instagram, kapı QR'ı, WhatsApp durumu) müdavimleriyle paylaşır.
      suggestedAction: {
        type: "kampanya_linki_olustur",
        mokaProduct: "Ödeme Linki",
        rationale:
          `Son 8 haftada ${lost.length} yerleşik müdavim normal ziyaret döngüsünü ` +
          `aştığı hâlde dönmedi; tahmini kayıp ~${Math.round(estLostRevenue)} TL. ` +
          `Son müşterinin iletişim bilgisi Moka'da olmadığından ona doğrudan ` +
          `ulaşılamaz. Bunun yerine indirimli bir kampanya/ödeme linki üretilir; ` +
          `esnaf bu linki kendi kanalından (Instagram, kapı QR'ı, WhatsApp durumu) ` +
          `müdavimleriyle paylaşır — müşteriye mesaj gönderilmez, yalnızca link üretilir.`,
      },
      timeframe: tf("son_8_hafta", LAST_DAY_INDEX - 55, LAST_DAY_INDEX),
      confidence: Math.min(1, 0.5 + lost.length / 20),
    });
  }

  return findings;
}
