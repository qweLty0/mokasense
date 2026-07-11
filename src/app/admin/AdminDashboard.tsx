"use client";

// Moka Yönetici Paneli — etkileşimli dashboard (P4-B).
// Kurumsal koyu tema + Moka moru. Sıralanabilir/filtrelenebilir işyeri tablosu,
// işyeri detayı ve çapraz satış hunisi. Veri: server'dan gelen agrega (gerçek).

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type {
  AdminAggregate,
  AdminMerchantRow,
  CrossSellSlice,
} from "@/lib/admin/aggregate";
import type { Severity } from "@/lib/engine/types";
import type { Sector } from "@/lib/types";

const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");

// Büyük tutarları kısa göster: 16.938.610 → "16,9M", 134.000 → "134 bin".
// Not: "B" (milyar) olarak yanlış okunmasın diye bin ayracı açıkça "bin" yazılır.
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} bin`;
  return tr(n);
}

// Moka ölçeği projeksiyonu için: milyon/bin okunur biçim.
function scaleLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} milyon`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString("tr-TR")} bin`;
  return tr(n);
}

const SEV_STYLE: Record<Severity, { label: string; cls: string }> = {
  kritik: { label: "Kritik", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  uyari: { label: "Uyarı", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  firsat: { label: "Fırsat", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  bilgi: { label: "Bilgi", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
};

const SEV_ORDER: Record<Severity, number> = { bilgi: 0, firsat: 1, uyari: 2, kritik: 3 };

const SECTORS: { id: Sector | "all"; label: string }[] = [
  { id: "all", label: "Tümü" },
  { id: "kasap", label: "Kasap" },
  { id: "kafe", label: "Kafe" },
  { id: "kuafor", label: "Kuaför" },
  { id: "eticaret", label: "E-ticaret" },
];

const PRODUCT_COLOR: Record<string, string> = {
  Taksit: "bg-violet-500",
  "Ödeme Linki": "bg-sky-500",
  "Ek Terminal": "bg-amber-500",
  "Dövizli Ödeme": "bg-emerald-500",
  Diğer: "bg-slate-500",
};

type SortKey = "revenue" | "findings" | "severity" | "name";

function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEV_STYLE[severity];
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

// --- KPI kartı ---
function Kpi({
  gear,
  label,
  value,
  unit,
  sub,
  accent,
}: {
  gear: string;
  label: string;
  value: string;
  unit?: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-white/40">{label}</div>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">{gear}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={`text-3xl font-bold ${accent}`}>{value}</span>
        {unit && <span className="text-sm text-white/40">{unit}</span>}
      </div>
      <div className="mt-1 text-xs text-white/50">{sub}</div>
    </div>
  );
}

// --- Moka ölçeği projeksiyonu ---
// 50 işyerlik örneklemin gerçek oranları, Moka'nın üye tabanına ölçeklenir.
// Pazar verisi (kaynak gösterilir): Türkiye'de 2,57 milyon esnaf işletmesi
// (Ticaret Bakanlığı, 2026); aylık kartlı ödeme hacmi 2,63 trilyon TL, yıllık
// %32 büyüme (BKM, Mayıs 2026). Projeksiyon örneklemden lineer türetilir; sabit
// uydurma sayı yoktur ve "tahmini projeksiyon" olduğu açıkça belirtilir.
const TARGET_FLEET = 10_000; // örnek üye işyeri filosu

function ScaleProjection({ aggregate }: { aggregate: AdminAggregate }) {
  const n = Math.max(1, aggregate.merchantCount);
  const scale = TARGET_FLEET / n;
  const items = [
    {
      label: "önlenen kayıp",
      sample: `${compact(aggregate.preventedLoss)} TL`,
      projected: `~${scaleLabel(aggregate.preventedLoss * scale)} TL`,
      accent: "text-emerald-300",
    },
    {
      label: "churn riski",
      sample: `${aggregate.churnRiskCount} işyeri`,
      projected: `~${scaleLabel(aggregate.churnRiskCount * scale)} işyeri`,
      accent: "text-amber-300",
    },
    {
      label: "çapraz satış fırsatı",
      sample: `${aggregate.crossSellTotal} öneri`,
      projected: `~${scaleLabel(aggregate.crossSellTotal * scale)} öneri`,
      accent: "text-sky-300",
    },
  ];

  return (
    <section className="mt-6 rounded-xl border border-moka/30 bg-moka/[0.06] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Moka Ölçeğinde Ne Demek?</h2>
        <span className="text-[11px] text-white/40">
          {aggregate.merchantCount} işyerlik örneklemden {TARGET_FLEET.toLocaleString("tr-TR")} üye işyerine — tahmini projeksiyon
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/50">{it.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xs text-white/40">{it.sample}</span>
              <span className="text-white/30">→</span>
              <span className={`text-xl font-bold ${it.accent}`}>{it.projected}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/40">
        Örneklem oranları doğrudan yukarı ölçeklenmiştir (gerçek orandan türetildi,
        sabit uydurma değil). Pazar bağlamı: Türkiye&apos;de{" "}
        <span className="text-white/60">2,57 milyon esnaf işletmesi</span> (Ticaret
        Bakanlığı, 2026); aylık kartlı ödeme hacmi{" "}
        <span className="text-white/60">2,63 trilyon TL</span>, yıllık %32 büyüme
        (BKM, Mayıs 2026). MokaSense üye tabanı büyüdükçe etki doğrusal ölçeklenir.
      </div>
    </section>
  );
}

// --- Çapraz satış hunisi ---
function CrossSellFunnel({ slices, total }: { slices: CrossSellSlice[]; total: number }) {
  const max = Math.max(1, ...slices.map((s) => s.count));
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-1 text-sm font-semibold text-white">Çapraz satış hunisi</div>
      <div className="mb-4 text-xs text-white/40">
        &quot;Uyumayan satış temsilcisi&quot; — hangi Moka ürünü kaç işyerine önerildi
      </div>
      <div className="space-y-3">
        {slices.map((s) => (
          <div key={s.product} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-xs text-white/60">{s.product}</div>
            <div className="h-6 flex-1 overflow-hidden rounded bg-black/30">
              <div
                className={`flex h-6 items-center justify-end rounded px-2 ${PRODUCT_COLOR[s.product] ?? "bg-slate-500"}`}
                style={{ width: `${Math.max(8, (s.count / max) * 100)}%` }}
              >
                <span className="text-[11px] font-semibold text-white">{s.count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-white/10 pt-3 text-xs text-white/40">
        Toplam {total} aktif çapraz satış önerisi · her biri &quot;neden şimdi, neden sen&quot; gerekçeli
      </div>
    </div>
  );
}

// --- İşyeri detay (genişletilmiş satır) ---
function MerchantDetail({ row }: { row: AdminMerchantRow }) {
  return (
    <div className="space-y-2 bg-black/20 px-4 py-4">
      <div className="text-xs text-white/40">
        MokaSense bu esnafta {row.findingCount} bulgu gördü:
      </div>
      {row.findings.map((f) => (
        <div key={f.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <span className="text-sm font-medium text-white">{f.title}</span>
            {f.mokaProduct && (
              <span className="rounded bg-moka/20 px-2 py-0.5 text-[11px] text-violet-200">
                → {f.mokaProduct}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs text-white/60">{f.detail}</div>
          {f.rationale && (
            <div className="mt-1.5 border-l-2 border-moka/40 pl-2 text-[11px] italic text-white/40">
              Öneri gerekçesi: {f.rationale}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard({ aggregate }: { aggregate: AdminAggregate }) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sector, setSector] = useState<Sector | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const filtered = aggregate.rows.filter((r) => sector === "all" || r.sector === sector);
    const sorted = [...filtered].sort((a, b) => {
      let d = 0;
      if (sortKey === "revenue") d = a.weekRevenue - b.weekRevenue;
      else if (sortKey === "findings") d = a.findingCount - b.findingCount;
      else if (sortKey === "severity") d = SEV_ORDER[a.topSeverity] - SEV_ORDER[b.topSeverity];
      else d = a.name.localeCompare(b.name, "tr");
      return sortDir === "asc" ? d : -d;
    });
    return sorted;
  }, [aggregate.rows, sector, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <main className="min-h-[100dvh] bg-[#0d0a14] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Başlık */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-moka">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-moka" />
              MokaSense · Moka Yönetici Paneli
            </div>
            <h1 className="mt-1 text-2xl font-semibold">İş Etkisi Panosu</h1>
            <p className="mt-1 text-sm text-white/40">
              {aggregate.merchantCount} aktif işyeri · MokaSense&apos;in Moka&apos;ya kattığı değer
            </p>
          </div>
          <nav className="flex gap-2 text-sm">
            <Link href="/" className="rounded-lg border border-white/10 px-3 py-1.5 text-white/60 hover:bg-white/5">
              ← Ana sayfa
            </Link>
            <Link href="/live" className="rounded-lg border border-moka/40 bg-moka/10 px-3 py-1.5 text-violet-200 hover:bg-moka/20">
              📡 Canlı Akış
            </Link>
          </nav>
        </header>

        {/* KPI şeridi — 5 dişli */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi
            gear="Dişli 1"
            label="İzlenen aylık hacim"
            value={compact(aggregate.estMonthlyVolume)}
            unit="TL"
            sub={`+${compact(aggregate.opportunityVolume)} TL büyütülebilir fırsat hacmi`}
            accent="text-white"
          />
          <Kpi
            gear="Dişli 2"
            label="Çapraz satış önerisi"
            value={String(aggregate.crossSellTotal)}
            sub={`~${aggregate.crossSellAccepted} aksiyona hazır (öneri güvenine göre %${Math.round(aggregate.crossSellAcceptanceRate * 100)})`}
            accent="text-sky-300"
          />
          <Kpi
            gear="Dişli 3"
            label="Churn riski"
            value={String(aggregate.churnRiskCount)}
            unit="işyeri"
            sub="sadakat döngüsü kırılan müdavimler tespit edildi"
            accent="text-amber-300"
          />
          <Kpi
            gear="Dişli 4"
            label="Önlenen kayıp"
            value={compact(aggregate.preventedLoss)}
            unit="TL"
            sub="anomali tespitiyle kurtarılan tahmini ciro"
            accent="text-emerald-300"
          />
          <Kpi
            gear="Dişli 5"
            label="Destek yükü azalması"
            value={String(aggregate.supportResolved)}
            unit="iş"
            sub="WhatsApp'ta çözüldü — panele girmeden, çağrı merkezi aranmadan (Moka operasyon maliyetini düşürür)"
            accent="text-violet-300"
          />
        </section>

        {/* Moka ölçeği projeksiyonu */}
        <ScaleProjection aggregate={aggregate} />

        {/* Huni + not */}
        <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CrossSellFunnel slices={aggregate.crossSellByProduct} total={aggregate.crossSellTotal} />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60">
            <div className="mb-2 font-semibold text-white">Nasıl okunmalı?</div>
            <p className="text-xs leading-relaxed text-white/50">
              Tüm sayılar {aggregate.merchantCount} işyerinin gerçek analiz bulgularından
              agrega edilir — uydurma sabit yoktur. Kartlı ciro büyüdükçe Moka&apos;nın
              işlem geliri büyür: &quot;esnafı zenginleştir&quot; ile &quot;Moka&apos;yı
              zenginleştir&quot; aynı motorun iki dişlisidir.
            </p>
          </div>
        </section>

        {/* İşyeri tablosu */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">İşyerleri</h2>
            <div className="flex flex-wrap gap-1">
              {SECTORS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSector(s.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition ${
                    sector === s.id
                      ? "bg-moka text-white"
                      : "border border-white/10 text-white/50 hover:bg-white/5"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-white/5 text-left text-white/50">
                <tr>
                  <th className="cursor-pointer px-4 py-3 font-medium hover:text-white" onClick={() => toggleSort("name")}>
                    İşyeri{arrow("name")}
                  </th>
                  <th className="px-4 py-3 font-medium">Sektör</th>
                  <th className="px-4 py-3 font-medium">Semt</th>
                  <th className="cursor-pointer px-4 py-3 text-right font-medium hover:text-white" onClick={() => toggleSort("revenue")}>
                    Haftalık ciro{arrow("revenue")}
                  </th>
                  <th className="cursor-pointer px-4 py-3 text-center font-medium hover:text-white" onClick={() => toggleSort("findings")}>
                    Bulgu{arrow("findings")}
                  </th>
                  <th className="cursor-pointer px-4 py-3 text-center font-medium hover:text-white" onClick={() => toggleSort("severity")}>
                    Kritiklik{arrow("severity")}
                  </th>
                  <th className="px-4 py-3 font-medium">Öneri</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded === r.merchantId;
                  return (
                    <Fragment key={r.merchantId}>
                      <tr
                        onClick={() => setExpanded(open ? null : r.merchantId)}
                        className={`cursor-pointer border-t border-white/5 transition hover:bg-white/[0.04] ${open ? "bg-white/[0.04]" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <span className="text-white/40">{open ? "▾ " : "▸ "}</span>
                          <span className="font-medium text-white">{r.name}</span>
                          {r.churnRisk && (
                            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                              churn
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-white/60">{r.sectorTr}</td>
                        <td className="px-4 py-3 text-white/60">{r.district}</td>
                        <td className="px-4 py-3 text-right text-white/80">{tr(r.weekRevenue)} TL</td>
                        <td className="px-4 py-3 text-center text-white/60">{r.findingCount}</td>
                        <td className="px-4 py-3 text-center">
                          <SeverityBadge severity={r.topSeverity} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {r.crossSellProducts.length === 0 ? (
                              <span className="text-xs text-white/30">—</span>
                            ) : (
                              r.crossSellProducts.map((p) => (
                                <span key={p} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60">
                                  {p}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <MerchantDetail row={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-white/30">
            Bir işyerine tıkla → MokaSense&apos;in gördüğü tüm bulgular ve önerilen Moka ürünleri.
          </div>
        </section>
      </div>
    </main>
  );
}
