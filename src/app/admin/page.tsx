// Moka Yönetici Paneli (P4-B) — /admin
// Amaç: "MokaSense Moka'ya ne kazandırıyor" görünümü (iş etkisi görünümü).
// ürünün 4 dişli buradan görünür. Tüm KPI'lar 50 işyerinin
// insights'larından GERÇEKTEN agrega edilir (bkz. lib/admin/aggregate.ts).

import Link from "next/link";
import { dataExists, insightsExist } from "@/lib/data";
import { buildAdminAggregate } from "@/lib/admin/aggregate";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  if (!dataExists() || !insightsExist()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-white">
        <h1 className="text-2xl font-semibold">Moka Yönetici Paneli</h1>
        <p className="mt-4 text-white/60">
          Panel için önce veri ve analiz üretilmeli:
        </p>
        <pre className="mt-4 rounded-lg bg-black/40 p-4 text-sm text-moka">
          npm run datagen{"\n"}npm run analyze
        </pre>
        <Link href="/" className="mt-6 inline-block text-sm text-moka hover:underline">
          ← Ana sayfa
        </Link>
      </main>
    );
  }

  const aggregate = buildAdminAggregate();
  return <AdminDashboard aggregate={aggregate} />;
}
