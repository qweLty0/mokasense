// Sentetik veri üretim orkestratörü.
// Çalıştırma: npm run datagen  (tsx src/lib/datagen/run.ts)
// Çıktılar: src/data/merchants.json, src/data/summary.json, src/data/tx/{merchantId}.json

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DataSummary, Sector, Transaction } from "../types";
import { SEED, DATE_START, DATE_END } from "./config";
import { generateMerchants, ANOMALY } from "./merchants";
import { generateTransactions } from "./transactions";
import { weekStartOf } from "./dates";

const DATA_DIR = join(process.cwd(), "src", "data");
const TX_DIR = join(DATA_DIR, "tx");

const SECTORS: Sector[] = ["kasap", "kafe", "kuafor", "eticaret"];

function sectorTR(s: Sector): string {
  return { kasap: "Kasap", kafe: "Kafe", kuafor: "Kuaför", eticaret: "E-ticaret" }[s];
}

function fmt(n: number): string {
  return n.toLocaleString("tr-TR");
}

function main() {
  const t0 = Date.now();
  console.log("MokaSense sentetik veri üreteci başladı");
  console.log(`Seed: ${SEED} | Aralık: ${DATE_START} → ${DATE_END}\n`);

  // Temiz başlangıç
  if (existsSync(TX_DIR)) rmSync(TX_DIR, { recursive: true, force: true });
  mkdirSync(TX_DIR, { recursive: true });

  const merchants = generateMerchants(SEED);
  writeFileSync(join(DATA_DIR, "merchants.json"), JSON.stringify(merchants, null, 2), "utf-8");

  // Toplu sayaçlar
  let totalTx = 0;
  const sectorBreakdown = {} as DataSummary["sectorBreakdown"];
  for (const s of SECTORS) sectorBreakdown[s] = { merchants: 0, transactions: 0 };

  let kafeAmountSum = 0;
  let kafeApprovedCount = 0;
  // Sektör bazında onaylı & iade edilmemiş işlem tutarları (ortalama + medyan için).
  const sectorAmounts = {} as Record<Sector, number[]>;
  for (const s of SECTORS) sectorAmounts[s] = [];
  let approvedTotal = 0;
  let declinedTotal = 0;
  let foreignTotal = 0;
  let overallCount = 0;

  // Örnek kafe doğrulama slice'ı
  const heroCafe = merchants.find((m) => m.anomalyTags?.includes(ANOMALY.HERO_CAFE))!;
  const heroWeekly = new Map<string, number>();

  for (const m of merchants) {
    const txs = generateTransactions(m, SEED);
    writeFileSync(join(TX_DIR, `${m.id}.json`), JSON.stringify(txs), "utf-8");

    sectorBreakdown[m.sector].merchants += 1;
    sectorBreakdown[m.sector].transactions += txs.length;
    totalTx += txs.length;

    for (const tx of txs) {
      overallCount++;
      if (tx.status === "approved") approvedTotal++;
      else declinedTotal++;
      if (tx.cardOrigin === "foreign") foreignTotal++;

      if (tx.status === "approved" && !tx.refunded) {
        sectorAmounts[m.sector].push(tx.amount);
        if (m.sector === "kafe") {
          kafeAmountSum += tx.amount;
          kafeApprovedCount++;
        }
      }

      // Örnek kafe: Salı(2)/Çarş(3), 14-16 saat, onaylı & iade edilmemiş ciro
      if (m.id === heroCafe.id) {
        const d = new Date(tx.timestamp);
        const dow = d.getUTCDay();
        const hour = Number(tx.timestamp.slice(11, 13));
        if (
          (dow === 2 || dow === 3) &&
          hour >= 14 &&
          hour <= 16 &&
          tx.status === "approved" &&
          !tx.refunded
        ) {
          const wk = weekStartOf(tx.timestamp.slice(0, 10));
          heroWeekly.set(wk, (heroWeekly.get(wk) ?? 0) + tx.amount);
        }
      }
    }
  }

  // Son 6 haftayı al
  const heroWeeklySorted = [...heroWeekly.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-6)
    .map(([weekStart, revenue]) => ({ weekStart, revenue: Math.round(revenue) }));

  const summary: DataSummary = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    dateRange: { start: DATE_START, end: DATE_END },
    merchantCount: merchants.length,
    transactionCount: totalTx,
    sectorBreakdown,
    checks: {
      kafeAvgTicket: Math.round((kafeAmountSum / kafeApprovedCount) * 100) / 100,
      overallDeclineRate: Math.round((declinedTotal / overallCount) * 10000) / 10000,
      foreignCardRate: Math.round((foreignTotal / overallCount) * 10000) / 10000,
      heroCafe: {
        merchantId: heroCafe.id,
        name: heroCafe.name,
        weeklyTueWedAfternoonRevenue: heroWeeklySorted,
      },
    },
  };
  writeFileSync(join(DATA_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");

  // --- Konsol özeti --------------------------------------------------------
  console.log("=".repeat(52));
  console.log("ÜRETİM ÖZETİ");
  console.log("=".repeat(52));
  console.log(`İşyeri sayısı      : ${fmt(merchants.length)}`);
  console.log(`Toplam işlem       : ${fmt(totalTx)}`);
  console.log("");
  console.log("Sektör dağılımı:");
  for (const s of SECTORS) {
    const b = sectorBreakdown[s];
    console.log(
      `  ${sectorTR(s).padEnd(10)} ${String(b.merchants).padStart(2)} işyeri  ` +
        `${fmt(b.transactions).padStart(9)} işlem`,
    );
  }
  console.log("");
  console.log("Sektör bazında işlem tutarı (onaylı, iade hariç):");
  console.log(`  ${"Sektör".padEnd(10)} ${"Ortalama".padStart(12)} ${"Medyan".padStart(10)}`);
  for (const s of SECTORS) {
    const arr = sectorAmounts[s];
    const mean = arr.reduce((a, v) => a + v, 0) / arr.length;
    const sorted = [...arr].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `  ${sectorTR(s).padEnd(10)} ${(fmt(Math.round(mean)) + " TL").padStart(12)} ` +
        `${(fmt(Math.round(median)) + " TL").padStart(10)}`,
    );
  }
  console.log("");
  console.log("Doğrulama metrikleri:");
  console.log(`  Kafe ortalama fişi : ${fmt(summary.checks.kafeAvgTicket)} TL`);
  console.log(`  Genel red oranı    : %${(summary.checks.overallDeclineRate * 100).toFixed(2)}`);
  console.log(`  Yabancı kart oranı : %${(summary.checks.foreignCardRate * 100).toFixed(2)}`);
  console.log("");
  console.log(
    `Örnek kafe [${heroCafe.name} / ${heroCafe.district}] — Salı-Çarş 14-17 haftalık ciro (son 6 hafta):`,
  );
  for (const w of heroWeeklySorted) {
    const bar = "█".repeat(Math.max(1, Math.round(w.revenue / 250)));
    console.log(`  ${w.weekStart}  ${fmt(w.revenue).padStart(7)} TL  ${bar}`);
  }
  const firstHalf = heroWeeklySorted.slice(0, 3).reduce((a, w) => a + w.revenue, 0) / 3;
  const lastHalf = heroWeeklySorted.slice(-3).reduce((a, w) => a + w.revenue, 0) / 3;
  const dropPct = Math.round((1 - lastHalf / firstHalf) * 100);
  console.log(
    `  → Son 3 hafta ortalaması, önceki 3 haftaya göre %${dropPct} ${
      dropPct > 0 ? "DÜŞÜK (çukur görünüyor ✓)" : "değişimi"
    }`,
  );
  console.log("");
  console.log(`Tamamlandı: ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
  console.log(`Çıktı dizini: ${DATA_DIR}`);
}

main();
