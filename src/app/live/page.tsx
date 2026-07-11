// Canlı İşlem Akışı (P4-B) — /live
// Amaç: demo açılışında "Moka'nın veri nabzı akıyor" sahne efekti.
// PERFORMANS: 132MB ham işlemi YÜKLEMEZ. Sadece işyeri listesi (hafif) + gerçek
// analiz bulgularından türetilmiş içgörü highlight'ları sunucudan gelir; akış
// istemcide sektör-tipik dağılımlarla sentezlenir (sentetik veri evreniyle tutarlı).

import Link from "next/link";
import { dataExists, insightsExist, loadSummary } from "@/lib/data";
import { buildAdminAggregate } from "@/lib/admin/aggregate";
import LiveStream, { type LiveMerchant, type LiveHighlight } from "./LiveStream";

export const dynamic = "force-dynamic";

export default function LivePage() {
  if (!dataExists() || !insightsExist()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-white">
        <h1 className="text-2xl font-semibold">Canlı Veri Akışı</h1>
        <p className="mt-4 text-white/60">Önce veri ve analiz üretilmeli:</p>
        <pre className="mt-4 rounded-lg bg-black/40 p-4 text-sm text-moka">
          npm run datagen{"\n"}npm run analyze
        </pre>
        <Link href="/" className="mt-6 inline-block text-sm text-moka hover:underline">
          ← Ana sayfa
        </Link>
      </main>
    );
  }

  const agg = buildAdminAggregate();
  const summary = loadSummary();

  const merchants: LiveMerchant[] = agg.rows.map((r) => ({
    id: r.merchantId,
    name: r.name,
    sector: r.sector,
    district: r.district,
  }));

  // İçgörü highlight'ları — GERÇEK bulgulardan türetilir (asistanın izlediği hissi).
  const highlights: LiveHighlight[] = [];
  const SECTOR_TR: Record<string, string> = {
    kasap: "kasapta",
    kafe: "kafede",
    kuafor: "kuaförde",
    eticaret: "e-ticarette",
  };
  for (const r of agg.rows) {
    for (const f of r.findings) {
      if (f.type === "anomali_ciro_dusus")
        highlights.push({ tone: "kritik", text: `${r.district}'de bir ${SECTOR_TR[r.sector]} öğleden sonra ciro düşüşü yakalandı` });
      else if (f.type === "anomali_red_artis")
        highlights.push({ tone: "kritik", text: `${r.district}'de bir ${SECTOR_TR[r.sector]} red oranı artışı tespit edildi` });
      else if (f.type === "anomali_iade_artis")
        highlights.push({ tone: "kritik", text: `${r.district}'de bir ${SECTOR_TR[r.sector]} iade artışı fark edildi` });
      else if (f.type === "sadakat_kayip")
        highlights.push({ tone: "uyari", text: `${r.district}'de bir ${SECTOR_TR[r.sector]} kaybolan müdavimler saptandı` });
      else if (f.type === "capraz_satis_dovizli")
        highlights.push({ tone: "firsat", text: `${r.district}'de yabancı kart artışı — dövizli ödeme fırsatı` });
      else if (f.type === "capraz_satis_ek_terminal")
        highlights.push({ tone: "firsat", text: `${r.name}: yoğun gün baskısı — ek terminal fırsatı` });
    }
  }

  // Taban sayaçlar (gerçek agregadan): "bugün" hissi için haftalıktan güne indir.
  const dailyVolumeBase = Math.round(agg.totalWeekRevenue / 7);
  const days = Math.max(
    1,
    Math.round(
      (new Date(summary.dateRange.end).getTime() - new Date(summary.dateRange.start).getTime()) /
        86_400_000,
    ),
  );
  const dailyCountBase = Math.round(summary.transactionCount / days);

  return (
    <LiveStream
      merchants={merchants}
      highlights={highlights}
      dailyVolumeBase={dailyVolumeBase}
      dailyCountBase={dailyCountBase}
    />
  );
}
