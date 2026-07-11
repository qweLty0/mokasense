// 50 işyeri üretir ve işaretli anomali senaryolarını belirli işyerlerine etiketler.
// Anomalilerin hangi işyerine denk geldiği deterministiktir (sabit seed).

import type { Merchant, Sector } from "../types";
import { Rng } from "./rng";
import {
  DISTRICTS,
  SECTOR_ACTIVE_PRODUCTS,
  SECTOR_COUNTS,
  SECTOR_NAME_POOLS,
} from "./config";

/** İşaretli anomali etiketleri (analiz motoru ve demo bunları arar). */
export const ANOMALY = {
  HERO_CAFE: "hero_cafe_tuewed_dip", // Kadıköy kafe, Salı-Çarş 14-17 son 3 hafta düşüş
  DECLINE_SPIKE: "decline_spike", // e-ticaret red %8→%24 teknik/tek banka
  REFUND_SPIKE: "refund_spike", // e-ticaret iade %3→%11 (750-900 TL bandı)
  LOYAL_CHURN: "loyal_churn", // kuaför 12-14 sadık müşteri 8 hafta kayıp
  FOREIGN_TREND: "foreign_trend", // yabancı kart %3→%10 trend
} as const;

const SECTOR_ORDER: Sector[] = ["kasap", "kafe", "kuafor", "eticaret"];

/** İşyeri id öneki (okunur id'ler: kasap-01, kafe-07 ...). */
function sectorPrefix(sector: Sector): string {
  return sector;
}

export function generateMerchants(seed: number): Merchant[] {
  const rng = new Rng(seed ^ 0x1a2b3c);
  const merchants: Merchant[] = [];

  for (const sector of SECTOR_ORDER) {
    const count = SECTOR_COUNTS[sector];
    const names = SECTOR_NAME_POOLS[sector];
    for (let i = 0; i < count; i++) {
      const idNum = String(i + 1).padStart(2, "0");
      const id = `${sectorPrefix(sector)}-${idNum}`;
      const isOnline = sector === "eticaret";
      // Kayıt tarihi: 2024-2025 arası (Moka müşterisi bir süredir).
      const signupYear = rng.pick([2024, 2025]);
      const signupMonth = String(rng.int(1, 12)).padStart(2, "0");
      const signupDay = String(rng.int(1, 28)).padStart(2, "0");

      merchants.push({
        id,
        name: names[i],
        sector,
        district: isOnline ? "Online" : rng.pick(DISTRICTS),
        city: "İstanbul",
        posType: sector === "eticaret" ? "sanal" : "fiziksel",
        signupDate: `${signupYear}-${signupMonth}-${signupDay}`,
        activeProducts: [...SECTOR_ACTIVE_PRODUCTS[sector]],
        anomalyTags: [],
      });
    }
  }

  // --- İşaretli anomalileri deterministik olarak ata --------------------------
  const bySector = (s: Sector) => merchants.filter((m) => m.sector === s);
  const addTag = (m: Merchant, tag: string) => {
    m.anomalyTags = [...(m.anomalyTags ?? []), tag];
  };

  // 1) Örnek kafe → Kadıköy'de bir kafe olmalı (tutarlı demo için sabit).
  const cafes = bySector("kafe");
  const heroCafe = cafes[0];
  heroCafe.district = "Kadıköy"; // demo tutarlılığı için sabit
  addTag(heroCafe, ANOMALY.HERO_CAFE);

  // 2) e-ticaret red patlaması
  const shops = bySector("eticaret");
  addTag(shops[0], ANOMALY.DECLINE_SPIKE);

  // 3) e-ticaret iade patlaması (farklı işyeri)
  addTag(shops[1], ANOMALY.REFUND_SPIKE);

  // 4) kuaför sadık müşteri kaybı
  const salons = bySector("kuafor");
  addTag(salons[0], ANOMALY.LOYAL_CHURN);

  // 5) yabancı kart trendi → 3 işyeri (turistik semt hissi: 2 kafe + 1 kuaför)
  addTag(cafes[3], ANOMALY.FOREIGN_TREND);
  cafes[3].district = "Beyoğlu";
  addTag(cafes[7], ANOMALY.FOREIGN_TREND);
  cafes[7].district = "Beşiktaş";
  addTag(salons[4], ANOMALY.FOREIGN_TREND);
  salons[4].district = "Sarıyer";

  return merchants;
}
