// Üretilen sentetik veriye sunucu tarafı erişim yardımcıları.
// Not: Bu dosya yalnızca sunucu bileşenlerinde (server component) kullanılmalıdır.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DataSummary, Merchant, Transaction } from "./types";
import type { Finding } from "./engine/types";

const DATA_DIR = join(process.cwd(), "src", "data");
const INSIGHTS_DIR = join(DATA_DIR, "insights");

/** Veri üretilmiş mi? (kullanıcı `npm run datagen` çalıştırmadıysa false) */
export function dataExists(): boolean {
  return existsSync(join(DATA_DIR, "summary.json"));
}

/** Üretim özetini okur. */
export function loadSummary(): DataSummary {
  return JSON.parse(readFileSync(join(DATA_DIR, "summary.json"), "utf-8")) as DataSummary;
}

/** Tüm işyerlerini okur. */
export function loadMerchants(): Merchant[] {
  return JSON.parse(readFileSync(join(DATA_DIR, "merchants.json"), "utf-8")) as Merchant[];
}

/** Tek bir işyerinin işlemlerini okur. */
export function loadTransactions(merchantId: string): Transaction[] {
  return JSON.parse(
    readFileSync(join(DATA_DIR, "tx", `${merchantId}.json`), "utf-8"),
  ) as Transaction[];
}

// --- Analiz Motoru çıktıları (önceden hesaplanmış bulgular) ----------------
// PERFORMANS: runtime ham işlemleri (132MB) değil, bu hafif bulgu dosyalarını okur.

/** Analiz çalıştırılmış mı? (kullanıcı `npm run analyze` çalıştırmadıysa false) */
export function insightsExist(): boolean {
  return existsSync(join(INSIGHTS_DIR, "index.json"));
}

/** Bir işyerinin önceden hesaplanmış bulgularını okur (ciddiyete göre sıralı). */
export function loadFindings(merchantId: string): Finding[] {
  const path = join(INSIGHTS_DIR, `${merchantId}.json`);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as Finding[];
}

/** Tüm işyerlerinin bulgu indeksini okur (admin paneli için özet). */
export function loadInsightsIndex(): {
  generatedAt: string;
  merchants: {
    merchantId: string;
    name: string;
    sector: string;
    district: string;
    findingCount: number;
    topSeverity: string;
    types: string[];
  }[];
} {
  return JSON.parse(readFileSync(join(INSIGHTS_DIR, "index.json"), "utf-8"));
}
