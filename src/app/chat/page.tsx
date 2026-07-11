// /chat — WhatsApp-görünümlü sohbet ekranı (P3-B, server component).
// Sunucuda 4 demo işletmesini seçer, bulgularını okur ve aksiyon butonlarını
// hazırlar; etkileşimli WhatsApp arayüzünü ChatClient'a devreder.
//
// Demo işletmeleri (insights index'inden bilinçli seçildi — her biri farklı
// bir özelliği sergiler):
//   kafe-01    Kahve Molası    → anomali (Salı-Çarş çukuru) — ÖRNEK ANOMALİ SENARYOSU
//   kasap-08   Öztürk Et Pazarı→ benchmark + sadakat + çapraz satış butonları
//   kuafor-01  Selin Kuaför    → kayıp sadık müşteri tespiti + öneriler
//   eticaret-01 TrendButik     → red anomalisi (kayıp durdurma) + destek kaydı

import Link from "next/link";
import { dataExists, insightsExist, loadMerchants, loadFindings } from "@/lib/data";
import { buildActionButtons } from "@/lib/language/actions";
import ChatClient, { type DemoMerchant } from "./ChatClient";

export const dynamic = "force-dynamic";

// Demo işletme kimlikleri ve sergiledikleri özellik (chip ipucu).
const DEMO: { id: string; note: string }[] = [
  { id: "kafe-01", note: "Anomali tespiti — Salı-Çarş öğleden sonra ciro çukuru" },
  { id: "kasap-08", note: "Semt/sektör kıyası + çapraz satış önerileri" },
  { id: "kuafor-01", note: "Kayıp sadık müşteri tespiti" },
  { id: "eticaret-01", note: "Red oranı anomalisi — kayıp durdurma" },
];

export default function ChatPage() {
  // Veri/analiz üretilmemişse çökme yerine net yönlendirme (gerçeklik kuralı).
  if (!dataExists() || !insightsExist()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold text-white">MokaSense · Sohbet</h1>
        <p className="mt-3 text-white/60">
          Demo için önce sentetik veri ve analiz üretilmeli:
        </p>
        <pre className="mt-4 rounded-lg bg-black/40 p-4 text-sm text-moka">
          npm run datagen{"\n"}npm run analyze
        </pre>
        <Link href="/" className="mt-6 text-sm text-moka hover:underline">
          ← Veri paneline dön
        </Link>
      </main>
    );
  }

  const all = loadMerchants();
  const merchants: DemoMerchant[] = [];
  for (const d of DEMO) {
    const m = all.find((x) => x.id === d.id);
    if (!m) continue; // beklenen id yoksa sessizce atla (üreteç değişmiş olabilir)
    const findings = loadFindings(m.id);
    merchants.push({
      id: m.id,
      name: m.name,
      sector: m.sector,
      district: m.district,
      note: d.note,
      actions: buildActionButtons(findings),
    });
  }

  return <ChatClient merchants={merchants} />;
}
