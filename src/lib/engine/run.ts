// Analiz Motoru toplu çalıştırıcı: tüm işyerleri için bulguları ÖNCEDEN hesaplar
// ve src/data/insights/ altına yazar (runtime 132MB'ı okumaz, bu dosyaları okur).
// Çalıştırma: npm run analyze  (tsx src/lib/engine/run.ts)

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Merchant, Sector, Transaction } from "../types";
import { ANOMALY } from "../datagen/merchants";
import {
  analyzeMerchant,
  buildBenchmarkPool,
  computeMerchantMetrics,
} from "./index";
import type { Finding, MerchantMetrics } from "./types";
import { selectPeers } from "./benchmark";

const DATA_DIR = join(process.cwd(), "src", "data");
const TX_DIR = join(DATA_DIR, "tx");
const INSIGHTS_DIR = join(DATA_DIR, "insights");

const SECTORS: Sector[] = ["kasap", "kafe", "kuafor", "eticaret"];
const DOW_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

function loadMerchants(): Merchant[] {
  return JSON.parse(readFileSync(join(DATA_DIR, "merchants.json"), "utf-8")) as Merchant[];
}
function loadTx(id: string): Transaction[] {
  return JSON.parse(readFileSync(join(TX_DIR, `${id}.json`), "utf-8")) as Transaction[];
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString("tr-TR");
}
function pct(n: number): string {
  return `%${(n * 100).toFixed(1)}`;
}
function ok(b: boolean): string {
  return b ? "✓ EVET" : "✗ HAYIR";
}

function main() {
  const t0 = Date.now();
  if (!existsSync(join(DATA_DIR, "merchants.json"))) {
    console.error("Veri yok. Önce: npm run datagen");
    process.exit(1);
  }
  console.log("MokaSense Analiz Motoru başladı (deterministik, sıfır AI)\n");

  if (existsSync(INSIGHTS_DIR)) rmSync(INSIGHTS_DIR, { recursive: true, force: true });
  mkdirSync(INSIGHTS_DIR, { recursive: true });

  const merchants = loadMerchants();

  // --- Faz 1: her işyerinin metriklerini hesapla (benchmark havuzu için) ----
  const metricsById = new Map<string, MerchantMetrics>();
  for (const m of merchants) {
    const txs = loadTx(m.id); // bir kez oku, metriği çıkar, bırak
    metricsById.set(m.id, computeMerchantMetrics(m, txs));
  }
  const pool = buildBenchmarkPool([...metricsById.values()]);

  // --- Faz 2: bulguları üret ve diske yaz -----------------------------------
  const allFindings = new Map<string, Finding[]>();
  const indexRows: {
    merchantId: string;
    name: string;
    sector: Sector;
    district: string;
    findingCount: number;
    topSeverity: string;
    types: string[];
  }[] = [];

  for (const m of merchants) {
    const txs = loadTx(m.id);
    const findings = analyzeMerchant(m, txs, pool, metricsById.get(m.id));
    allFindings.set(m.id, findings);
    writeFileSync(join(INSIGHTS_DIR, `${m.id}.json`), JSON.stringify(findings, null, 2), "utf-8");
    indexRows.push({
      merchantId: m.id,
      name: m.name,
      sector: m.sector,
      district: m.district,
      findingCount: findings.length,
      topSeverity: findings[0]?.severity ?? "bilgi",
      types: findings.map((f) => f.type),
    });
  }
  writeFileSync(
    join(INSIGHTS_DIR, "index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), merchants: indexRows }, null, 2),
    "utf-8",
  );

  const findingOf = (id: string, type: string) =>
    (allFindings.get(id) ?? []).find((f) => f.type === type);
  const byTag = (tag: string) => merchants.find((m) => m.anomalyTags?.includes(tag));

  // =========================== DOĞRULAMA ===================================
  console.log("=".repeat(60));
  console.log("DOĞRULAMA — planlı senaryolar yakalandı mı?");
  console.log("=".repeat(60));

  // 1) Örnek kafe — Salı-Çarş 14-17 çukuru
  const hero = byTag(ANOMALY.HERO_CAFE)!;
  const dip = findingOf(hero.id, "anomali_ciro_dusus");
  {
    const dows = (dip?.metrics.affectedDows as number[]) ?? [];
    const hs = (dip?.metrics.hourStart as number) ?? -1;
    const he = (dip?.metrics.hourEnd as number) ?? -1;
    const drop = (dip?.metrics.dropPct as number) ?? 0;
    const lost = (dip?.metrics.estimatedLostRevenue as number) ?? 0;
    const hitsTueWed = dows.includes(2) && dows.includes(3);
    const hitsHours = hs >= 13 && hs <= 15;
    console.log(`\n1) ÖRNEK KAFE [${hero.name} / ${hero.district}]`);
    console.log(`   Ciro düşüşü bulundu       : ${ok(!!dip)}`);
    console.log(
      `   Etkilenen günler          : ${dows.map((d) => DOW_TR[d]).join(", ") || "-"} ` +
        `(Salı+Çarşamba mı? ${ok(hitsTueWed)})`,
    );
    console.log(`   Saat dilimi               : ${hs}:00-${he + 1}:00 (14-17 civarı mı? ${ok(hitsHours)})`);
    console.log(`   Düşüş büyüklüğü            : ${pct(drop)}`);
    console.log(`   Tahmini kayıp ciro        : ${fmt(lost)} TL`);
  }

  // 2) E-ticaret red anomalisi
  const declineM = byTag(ANOMALY.DECLINE_SPIKE)!;
  const dec = findingOf(declineM.id, "anomali_red_artis");
  {
    const base = (dec?.metrics.baselineDeclineRate as number) ?? 0;
    const rec = (dec?.metrics.recentDeclineRate as number) ?? 0;
    const bank = (dec?.metrics.topBank as string) ?? "-";
    const bankShare = (dec?.metrics.topBankShare as number) ?? 0;
    const reason = (dec?.metrics.topDeclineReason as string) ?? "-";
    console.log(`\n2) E-TİCARET RED ANOMALİSİ [${declineM.name}]`);
    console.log(`   Red artışı bulundu        : ${ok(!!dec)}`);
    console.log(`   Baz → son 4 gün           : ${pct(base)} → ${pct(rec)}`);
    console.log(
      `   Tek banka yoğunlaşması    : ${bank} (${pct(bankShare)} pay) ` +
        `— tek bankada mı? ${ok(bankShare >= 0.4)}`,
    );
    console.log(`   Baskın hata kodu          : ${reason}`);
  }

  // 3) E-ticaret iade anomalisi
  const refundM = byTag(ANOMALY.REFUND_SPIKE)!;
  const ref = findingOf(refundM.id, "anomali_iade_artis");
  {
    const base = (ref?.metrics.baselineRefundRate as number) ?? 0;
    const rec = (ref?.metrics.recentRefundRate as number) ?? 0;
    const lo = (ref?.metrics.concentratedBandLow as number) ?? 0;
    const hi = (ref?.metrics.concentratedBandHigh as number) ?? 0;
    const bandRate = (ref?.metrics.concentratedBandRefundRate as number) ?? 0;
    // Yoğun bandın 750-900 çevresine denk gelip gelmediği (bin genişliği 150)
    const bandHit = lo >= 600 && hi <= 1050;
    console.log(`\n3) E-TİCARET İADE ANOMALİSİ [${refundM.name}]`);
    console.log(`   İade artışı bulundu       : ${ok(!!ref)}`);
    console.log(`   Baz → son dönem iade      : ${pct(base)} → ${pct(rec)}`);
    console.log(
      `   Yoğun fiyat bandı         : ${lo}-${hi} TL (bant iade oranı ${pct(bandRate)}) ` +
        `— 750-900 civarı mı? ${ok(bandHit)}`,
    );
  }

  // 4) Kuaför sadakat kaybı
  const churnM = byTag(ANOMALY.LOYAL_CHURN)!;
  const churn = findingOf(churnM.id, "sadakat_kayip");
  {
    const lostCount = (churn?.metrics.lostCount as number) ?? 0;
    const estLost = (churn?.metrics.estimatedLostRevenue as number) ?? 0;
    const cycle = (churn?.metrics.medianCycleDays as number) ?? 0;
    console.log(`\n4) KUAFÖR SADAKAT KAYBI [${churnM.name}]`);
    console.log(`   Kayıp sadık tespit edildi : ${ok(!!churn)}`);
    console.log(
      `   Kayıp müşteri sayısı      : ${lostCount} (13 civarı mı? ${ok(lostCount >= 11 && lostCount <= 16)})`,
    );
    console.log(`   Medyan dönüş döngüsü      : ${Math.round(cycle)} gün`);
    console.log(`   Tahmini kayıp ciro        : ${fmt(estLost)} TL`);
  }

  // 5) Benchmark — örnek bir kafe (anomalisiz)
  const sampleCafe = merchants.find(
    (m) => m.sector === "kafe" && !m.anomalyTags?.includes(ANOMALY.HERO_CAFE),
  )!;
  const bm = findingOf(sampleCafe.id, "benchmark_konum");
  {
    const mx = metricsById.get(sampleCafe.id)!;
    const { peers, basis } = selectPeers(mx, pool);
    console.log(`\n5) BENCHMARK ÖRNEĞİ [${sampleCafe.name} / ${sampleCafe.district}]`);
    console.log(`   Kıyas grubu               : ${basis} (${peers.length} işyeri)`);
    console.log(
      `   Ort. fiş percentile       : üst %${Math.round(
        100 - ((bm?.metrics.avgTicketPercentile as number) ?? 50),
      )} (${fmt(mx.avgTicket)} TL)`,
    );
    console.log(
      `   Sadakat oranı percentile  : üst %${Math.round(
        100 - ((bm?.metrics.repeatRatePercentile as number) ?? 50),
      )} (${pct(mx.repeatCustomerRate)})`,
    );
    console.log(
      `   Ciro büyüme percentile    : üst %${Math.round(
        100 - ((bm?.metrics.revenueGrowthPercentile as number) ?? 50),
      )}`,
    );
  }

  // 6) Her sektörden 1 örnek işyerinin bulgu özeti
  console.log("\n" + "=".repeat(60));
  console.log("SEKTÖR BAŞINA ÖRNEK BULGU ÖZETİ");
  console.log("=".repeat(60));
  for (const s of SECTORS) {
    const m = merchants.find((mm) => mm.sector === s)!;
    const fs = allFindings.get(m.id) ?? [];
    console.log(`\n[${s}] ${m.name} — ${fs.length} bulgu`);
    for (const f of fs) {
      console.log(
        `   • ${f.severity.toUpperCase().padEnd(6)} ${f.type.padEnd(24)}` +
          `${f.suggestedAction ? ` → ${f.suggestedAction.mokaProduct ?? f.suggestedAction.type}` : ""}`,
      );
    }
  }

  // --- Özet ----------------------------------------------------------------
  const totalFindings = [...allFindings.values()].reduce((a, f) => a + f.length, 0);
  console.log("\n" + "=".repeat(60));
  console.log(
    `Tamamlandı: ${merchants.length} işyeri, ${totalFindings} bulgu, ` +
      `${((Date.now() - t0) / 1000).toFixed(1)} sn`,
  );
  console.log(`Çıktı dizini: ${INSIGHTS_DIR}`);
}

main();
