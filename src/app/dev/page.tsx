// /dev — Geliştirici görünümü · Sentetik Veri Sağlık Paneli.
// Ana sayfadan taşındı: kullanıcının gördüğü ilk ekran ürün vitrini olsun diye
// veri doğrulama metrikleri buraya ayrıldı. Üreteç mantığının doğru çalıştığını
// (deterministik seed, sektör dağılımı, işaretli anomaliler) burada doğrularız.

import Link from "next/link";
import type { Sector } from "@/lib/types";
import { dataExists, loadSummary, loadMerchants } from "@/lib/data";

// Veriyi istek anında (fs) okuduğumuz için statik prerender'ı kapatıyoruz.
export const dynamic = "force-dynamic";

const SECTOR_TR: Record<Sector, string> = {
  kasap: "Kasap",
  kafe: "Kafe",
  kuafor: "Kuaför",
  eticaret: "E-ticaret",
};

const tr = (n: number) => n.toLocaleString("tr-TR");

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="text-sm text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  );
}

export default function DevPage() {
  if (!dataExists()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-2xl font-semibold">MokaSense · Geliştirici görünümü</h1>
        <p className="mt-4 text-white/60">
          Sentetik veri henüz üretilmemiş. Önce şu komutu çalıştırın:
        </p>
        <pre className="mt-4 rounded-lg bg-black/40 p-4 text-moka">npm run datagen</pre>
        <Link href="/" className="mt-6 inline-block text-sm text-moka hover:underline">
          ← Ana sayfa
        </Link>
      </main>
    );
  }

  const summary = loadSummary();
  const merchants = loadMerchants();
  const sectors = Object.keys(summary.sectorBreakdown) as Sector[];

  const hero = summary.checks.heroCafe;
  const weeks = hero.weeklyTueWedAfternoonRevenue;
  const maxRev = Math.max(1, ...weeks.map((w) => w.revenue));
  const firstHalf = weeks.slice(0, 3).reduce((a, w) => a + w.revenue, 0) / Math.max(1, weeks.slice(0, 3).length);
  const lastHalf = weeks.slice(-3).reduce((a, w) => a + w.revenue, 0) / Math.max(1, weeks.slice(-3).length);
  const dropPct = firstHalf > 0 ? Math.round((1 - lastHalf / firstHalf) * 100) : 0;

  // İşaretli anomalilerin kaç işyerine denk geldiğini göster (doğrulama).
  const anomalyMerchants = merchants.filter((m) => (m.anomalyTags?.length ?? 0) > 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <div className="text-sm font-medium text-white/40">🛠️ Geliştirici görünümü · Veri Sağlık Paneli</div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Sentetik Veri Özeti</h1>
        <p className="mt-2 text-white/50">
          Üreteç deterministik (seed {summary.seed}). Aşağıdaki metrikler üreteç
          mantığının doğru çalıştığını doğrular. Ürün ekranları için{" "}
          <Link href="/" className="text-moka hover:underline">
            ana sayfaya
          </Link>{" "}
          dön.
        </p>
      </header>

      {/* Genel istatistikler */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="İşyeri" value={tr(summary.merchantCount)} />
        <StatCard label="Toplam işlem" value={tr(summary.transactionCount)} />
        <StatCard
          label="Tarih aralığı"
          value={summary.dateRange.start.slice(5)}
          sub={`→ ${summary.dateRange.end}`}
        />
        <StatCard label="İşaretli anomali" value={`${anomalyMerchants.length} işyeri`} />
      </section>

      {/* Sektör dağılımı */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-medium text-white">Sektör dağılımı</h2>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/50">
              <tr>
                <th className="px-4 py-3 font-medium">Sektör</th>
                <th className="px-4 py-3 font-medium">İşyeri</th>
                <th className="px-4 py-3 font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => (
                <tr key={s} className="border-t border-white/5">
                  <td className="px-4 py-3 text-white">{SECTOR_TR[s]}</td>
                  <td className="px-4 py-3 text-white/70">{tr(summary.sectorBreakdown[s].merchants)}</td>
                  <td className="px-4 py-3 text-white/70">
                    {tr(summary.sectorBreakdown[s].transactions)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Doğrulama metrikleri */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-medium text-white">Doğrulama metrikleri</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Kafe ortalama fişi"
            value={`${tr(summary.checks.kafeAvgTicket)} TL`}
            sub="onaylı & iade edilmemiş"
          />
          <StatCard
            label="Genel red oranı"
            value={`%${(summary.checks.overallDeclineRate * 100).toFixed(2)}`}
          />
          <StatCard
            label="Yabancı kart oranı"
            value={`%${(summary.checks.foreignCardRate * 100).toFixed(2)}`}
            sub="hedef taban ~%3"
          />
        </div>
      </section>

      {/* Örnek kafe çukuru */}
      <section className="mt-10">
        <h2 className="mb-1 text-lg font-medium text-white">
          Örnek kafe çukuru — {hero.name}
        </h2>
        <p className="mb-4 text-sm text-white/50">
          Salı-Çarşamba 14:00-17:00 dilimi haftalık ciro (son 6 hafta). Son haftalarda
          belirgin düşüş beklenir — örnek anomali senaryosu.
        </p>
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-5">
          {weeks.map((w, i) => {
            const isRecent = i >= weeks.length - 3;
            return (
              <div key={w.weekStart} className="flex items-center gap-3">
                <div className="w-24 shrink-0 text-xs text-white/50">{w.weekStart}</div>
                <div className="h-5 flex-1 rounded bg-black/30">
                  <div
                    className={`h-5 rounded ${isRecent ? "bg-red-500/70" : "bg-emerald-500/70"}`}
                    style={{ width: `${(w.revenue / maxRev) * 100}%` }}
                  />
                </div>
                <div className="w-20 shrink-0 text-right text-xs text-white/70">
                  {tr(w.revenue)} TL
                </div>
              </div>
            );
          })}
          <div className="mt-3 border-t border-white/10 pt-3 text-sm">
            {dropPct > 0 ? (
              <span className="text-red-400">
                ✓ Çukur görünüyor: son 3 hafta ortalaması önceki 3 haftaya göre %{dropPct} düşük
              </span>
            ) : (
              <span className="text-white/50">Belirgin çukur tespit edilmedi (%{dropPct})</span>
            )}
          </div>
        </div>
      </section>

      <footer className="mt-12 text-xs text-white/30">
        Üretim zamanı: {new Date(summary.generatedAt).toLocaleString("tr-TR")}
      </footer>
    </main>
  );
}
