// Basit unit testler (proje standartları) — kritik saf hesaplar.
// Harici test koşucusu yok; kendi minik assert harness'iyle çalışır.
// Çalıştırma: npm run test:engine  (tsx src/lib/engine/engine.test.ts)

import type { Transaction } from "../types";
import { percentileRank, median, dateOfIndex, LAST_DAY_INDEX } from "./util";
import { visitGaps, distinctVisitDays } from "./metrics";
import { detectLostLoyal } from "./loyalty";
import { isRateSpike } from "./anomaly";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}
function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

// Minimal işlem üretici (test için)
function tx(dayIdx: number, token: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id: `${token}-${dayIdx}`,
    merchantId: "test",
    timestamp: `${dateOfIndex(dayIdx)}T12:00:00+03:00`,
    amount: 100,
    cardToken: token,
    cardType: "credit",
    cardOrigin: "domestic",
    issuerBank: "İş Bankası",
    cardSegment: "classic",
    installments: 1,
    channel: "magaza",
    status: "approved",
    declineReason: null,
    refunded: false,
    contactless: false,
    ...over,
  };
}

console.log("Analiz Motoru unit testleri\n");

// --- percentileRank -------------------------------------------------------
console.log("percentileRank:");
assert(approx(percentileRank([1, 2, 3, 4], 4), 100), "en yüksek değer → %100");
assert(approx(percentileRank([1, 2, 3, 4], 1), 25), "en düşük değer → %25");
assert(approx(percentileRank([10, 20, 30, 40], 25), 50), "ortada → %50");
assert(approx(percentileRank([], 5), 50), "boş dizi → %50 (nötr)");

// --- median & visitGaps ---------------------------------------------------
console.log("median & döngü:");
assert(approx(median([3, 1, 2]), 2), "tek sayı medyan");
assert(approx(median([1, 2, 3, 4]), 2.5), "çift sayı medyan");
assert(
  JSON.stringify(visitGaps([10, 45, 80])) === JSON.stringify([35, 35]),
  "ziyaret aralıkları (döngü) doğru",
);
assert(
  JSON.stringify(distinctVisitDays([5, 5, 10, 3, 10])) === JSON.stringify([3, 5, 10]),
  "benzersiz ziyaret günleri sıralı & tekilleştirilmiş",
);

// --- isRateSpike (anomali eşiği) ------------------------------------------
console.log("isRateSpike (red eşiği):");
assert(isRateSpike(0.05, 0.2) === true, "baz %5 → %20 patlama sayılır");
assert(isRateSpike(0.05, 0.055) === false, "küçük artış patlama değil");
assert(isRateSpike(0.02, 0.05) === false, "eşik altı (floor %6) patlama değil");
assert(isRateSpike(0.15, 0.22) === false, "yüksek bazda faktör altı (muhafazakâr) — patlama değil");
assert(isRateSpike(0.15, 0.3) === true, "yüksek baz + faktör üstü artış patlama");

// --- detectLostLoyal (sadakat döngüsü kaybı) ------------------------------
console.log("detectLostLoyal:");
{
  const txs: Transaction[] = [
    // Kayıp: 3 ziyaret, döngü ~35 gün, son ziyaret 56 gün önce (>35*1.5)
    tx(LAST_DAY_INDEX - 126, "churned"),
    tx(LAST_DAY_INDEX - 91, "churned"),
    tx(LAST_DAY_INDEX - 56, "churned"),
    // Aktif sadık: son ziyaret 6 gün önce → kayıp değil
    tx(LAST_DAY_INDEX - 86, "active"),
    tx(LAST_DAY_INDEX - 46, "active"),
    tx(LAST_DAY_INDEX - 6, "active"),
    // Tek ziyaret: yerleşik değil → sayılmaz
    tx(LAST_DAY_INDEX - 100, "oneoff"),
  ];
  const lost = detectLostLoyal(txs);
  assert(lost.length === 1, `sadece 1 kayıp bekleniyor (bulunan: ${lost.length})`);
  assert(lost[0]?.token === "churned", "kayıp müşteri doğru tokenda");
  assert(lost[0]?.visits === 3, "kayıp müşteri 3 ziyaretli yerleşik");
}

// --- Sonuç ----------------------------------------------------------------
console.log(`\n${passed} geçti, ${failed} kaldı`);
if (failed > 0) process.exit(1);
