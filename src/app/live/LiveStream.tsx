"use client";

// Canlı İşlem Akışı — sahne efekti (P4-B).
// Sentetik işlemler istemcide, sektör-tipik dağılımlarla saniyede birkaç kez
// üretilir; canlı sayaçlar ve gerçek bulgulardan gelen içgörü pop'ları akar.
// Not: Bu ekran DEMO görselleştirmesidir (sentetik veri evreni) — üretim
// gerçek-zamanlı akışı değildir; alt notta dürüstçe belirtilir.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Sector } from "@/lib/types";

export interface LiveMerchant {
  id: string;
  name: string;
  sector: Sector;
  district: string;
}
export interface LiveHighlight {
  tone: "kritik" | "uyari" | "firsat";
  text: string;
}

interface LiveTx {
  key: number;
  name: string;
  district: string;
  sectorTr: string;
  amount: number;
  channel: string;
  cardType: string;
  foreign: boolean;
  time: string;
}

const SECTOR_TR: Record<Sector, string> = {
  kasap: "Kasap",
  kafe: "Kafe",
  kuafor: "Kuaför",
  eticaret: "E-ticaret",
};

// Sektör-tipik tutar dağılımı — datagen (config.ts / transactions.ts) ile BİREBİR
// aynı lognormal parametreleri. Böylece canlı akıştaki tutarlar sentetik veri
// evreniyle tutarlı olur (kafe ~800, kasap ~1400, kuaför ~700, e-ticaret ~900 TL
// ortalama). Kanal payları da datagen'deki primaryChannel/phoneOrderProb ile uyumlu.
const SECTOR_CFG: Record<Sector, { median: number; sigma: number; online: number; phone: number }> = {
  kasap: { median: 985, sigma: 0.5, online: 0, phone: 0.04 },
  kafe: { median: 555, sigma: 0.52, online: 0, phone: 0.02 },
  kuafor: { median: 490, sigma: 0.52, online: 0, phone: 0.03 },
  eticaret: { median: 600, sigma: 0.6, online: 1, phone: 0 },
};

// Kart segmenti harcama çarpanı (datagen SEGMENT_WEIGHTS + segmentAmountFactor).
const SEGMENT_FACTORS = [1.0, 1.15, 1.4, 1.5];
const SEGMENT_WEIGHTS = [62, 24, 8, 6];

// Standart normal (Box-Muller) — datagen rng.gauss ile aynı dağılım.
function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Lognormal sepet tutarı (datagen rng.lognormal ile aynı).
function lognormal(median: number, sigma: number): number {
  return median * Math.exp(sigma * gauss());
}

function pickSegmentFactor(): number {
  const total = SEGMENT_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SEGMENT_WEIGHTS.length; i++) {
    r -= SEGMENT_WEIGHTS[i];
    if (r <= 0) return SEGMENT_FACTORS[i];
  }
  return SEGMENT_FACTORS[0];
}

const CARD_TYPES = ["Kredi", "Kredi", "Kredi", "Banka", "Banka", "Ön ödemeli"];
const TONE_STYLE: Record<LiveHighlight["tone"], string> = {
  kritik: "border-red-500/40 bg-red-500/10 text-red-200",
  uyari: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  firsat: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};
const TONE_ICON: Record<LiveHighlight["tone"], string> = {
  kritik: "⚠️",
  uyari: "👀",
  firsat: "✨",
};

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function nowStr(): string {
  return new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function synth(merchants: LiveMerchant[], key: number): LiveTx {
  const m = pick(merchants);
  const cfg = SECTOR_CFG[m.sector];
  // datagen ile aynı: lognormal sepet × kişisel harcama × segment çarpanı.
  const raw = lognormal(cfg.median, cfg.sigma) * lognormal(1, 0.3) * pickSegmentFactor();
  const amount = Math.round(Math.max(15, raw));
  const roll = Math.random();
  const channel = roll < cfg.online ? "Online" : roll < cfg.online + cfg.phone ? "Telefon" : "Mağaza";
  const foreign = Math.random() < (m.sector === "kafe" || m.sector === "eticaret" ? 0.06 : 0.03);
  return {
    key,
    name: m.name,
    district: m.district,
    sectorTr: SECTOR_TR[m.sector],
    amount,
    channel,
    cardType: pick(CARD_TYPES),
    foreign,
    time: nowStr(),
  };
}

const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");

export default function LiveStream({
  merchants,
  highlights,
  dailyVolumeBase,
  dailyCountBase,
}: {
  merchants: LiveMerchant[];
  highlights: LiveHighlight[];
  dailyVolumeBase: number;
  dailyCountBase: number;
}) {
  const [feed, setFeed] = useState<LiveTx[]>([]);
  // Sayaçlar: günün ~%40'ı geçmiş gibi tabandan başlar, akışla artar.
  const [volume, setVolume] = useState(() => Math.round(dailyVolumeBase * 0.4));
  const [count, setCount] = useState(() => Math.round(dailyCountBase * 0.4));
  const [pop, setPop] = useState<LiveHighlight | null>(null);
  const [paused, setPaused] = useState(false);

  const keyRef = useRef(0);
  const hlRef = useRef(0);

  // İşlem akışı
  useEffect(() => {
    if (paused || merchants.length === 0) return;
    const id = window.setInterval(() => {
      const n = 1 + (Math.random() < 0.4 ? 1 : 0); // saniyede birkaç
      setFeed((prev) => {
        const added: LiveTx[] = [];
        let addVol = 0;
        for (let i = 0; i < n; i++) {
          const t = synth(merchants, keyRef.current++);
          added.push(t);
          addVol += t.amount;
        }
        setVolume((v) => v + addVol);
        setCount((c) => c + n);
        return [...added.reverse(), ...prev].slice(0, 40);
      });
    }, 420);
    return () => window.clearInterval(id);
  }, [paused, merchants]);

  // İçgörü pop'ları (gerçek bulgulardan), dönerek
  useEffect(() => {
    if (paused || highlights.length === 0) return;
    const show = () => {
      setPop(highlights[hlRef.current % highlights.length]);
      hlRef.current += 1;
      window.setTimeout(() => setPop(null), 4200);
    };
    const first = window.setTimeout(show, 2500);
    const id = window.setInterval(show, 6500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [paused, highlights]);

  return (
    <main className="min-h-[100dvh] bg-[#0a0710] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Başlık */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-moka">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              MokaSense · Canlı Veri Nabzı
            </div>
            <h1 className="mt-1 text-2xl font-semibold">Moka İşlem Akışı</h1>
            <p className="mt-1 max-w-xl text-sm text-white/50">
              Moka&apos;nın sunucularına her saniye bu veri akıyor. MokaSense
              sürekli izliyor, fırsat ve riskleri yakalıyor.
            </p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setPaused((p) => !p)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-white/60 hover:bg-white/5"
            >
              {paused ? "▶ Devam" : "⏸ Duraklat"}
            </button>
            <Link href="/admin" className="rounded-lg border border-moka/40 bg-moka/10 px-3 py-1.5 text-violet-200 hover:bg-moka/20">
              📊 Yönetici Paneli
            </Link>
            <Link href="/" className="rounded-lg border border-white/10 px-3 py-1.5 text-white/60 hover:bg-white/5">
              ← Ana sayfa
            </Link>
          </nav>
        </header>

        {/* Sayaçlar */}
        <section className="grid grid-cols-3 gap-4">
          <Counter label="Bugün toplam hacim" value={`${tr(volume)} ₺`} accent="text-emerald-300" />
          <Counter label="İşlem sayısı" value={tr(count)} accent="text-sky-300" />
          <Counter label="Aktif işyeri" value={tr(merchants.length)} accent="text-violet-300" />
        </section>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Akış */}
          <section className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white/60">Canlı işlemler</h2>
              <span className="text-xs text-white/30">en yeni üstte</span>
            </div>
            <div className="h-[560px] overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
              <ul>
                {feed.map((t, i) => (
                  <li
                    key={t.key}
                    className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 text-sm"
                    style={{ opacity: i === 0 ? 1 : Math.max(0.35, 1 - i * 0.03) }}
                  >
                    <span className="w-16 shrink-0 font-mono text-[11px] text-white/30">{t.time}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-white">{t.name}</span>
                      <span className="ml-2 text-xs text-white/40">
                        {t.sectorTr} · {t.district}
                      </span>
                    </span>
                    <span className="hidden shrink-0 gap-1 sm:flex">
                      <Tag>{t.channel}</Tag>
                      <Tag>{t.cardType}</Tag>
                      {t.foreign && <Tag accent>🌍 Yabancı</Tag>}
                    </span>
                    <span className="w-24 shrink-0 text-right font-semibold text-emerald-300">
                      {tr(t.amount)} ₺
                    </span>
                  </li>
                ))}
                {feed.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-white/30">Akış başlıyor…</li>
                )}
              </ul>
            </div>
          </section>

          {/* İçgörü pop + açıklama */}
          <section className="space-y-4">
            <div className="relative h-[200px] overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-sm font-medium text-white/60">MokaSense izliyor</div>
              <div className="mt-1 text-xs text-white/30">
                Akışı sürekli tarar; bir fırsat/anomali görünce yakalar.
              </div>
              {pop ? (
                <div
                  className={`mt-4 animate-[fadeIn_0.3s_ease] rounded-lg border p-3 text-sm ${TONE_STYLE[pop.tone]}`}
                >
                  <div className="text-lg">{TONE_ICON[pop.tone]} MokaSense içgörü yakaladı</div>
                  <div className="mt-1 leading-snug">{pop.text}</div>
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-2 text-sm text-white/30">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-moka" />
                  taranıyor…
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-white/40">
              <div className="mb-1 font-semibold text-white/60">Bu ekran nedir?</div>
              Moka&apos;nın işlem hacminin canlı nabzı. İçgörü bildirimleri {highlights.length} gerçek
              analiz bulgusundan gelir. Akış, demo için sentetik veri evreninden
              üretilir — üretim gerçek-zamanlı akışını temsil eder.
            </div>
          </section>
        </div>
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
    </main>
  );
}

function Counter({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        accent ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-white/50"
      }`}
    >
      {children}
    </span>
  );
}
