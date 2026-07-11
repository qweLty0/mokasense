// Ana sayfa (/) — ürün vitrini.
// Kullanıcının gördüğü İLK ekran budur; ürünü SATAR. Slogan + tek cümle tanım +
// problem/çözüm + üç ekran girişi (chat/admin/live) + mimari notu.
// Sentetik veri sağlık paneli /dev rotasına taşındı (küçük bir link kalır).

import Link from "next/link";
import { dataExists } from "@/lib/data";

// Veriyi istek anında (fs) okuduğumuz için statik prerender'ı kapatıyoruz.
export const dynamic = "force-dynamic";

function EntryCard({
  href,
  emoji,
  title,
  desc,
  cta,
  className,
  ctaClassName,
}: {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  cta: string;
  className: string;
  ctaClassName: string;
}) {
  return (
    <Link href={href} className={`group flex flex-col rounded-2xl border p-6 transition ${className}`}>
      <div className="text-3xl">{emoji}</div>
      <div className="mt-3 text-base font-semibold text-white">{title}</div>
      <div className="mt-1 flex-1 text-sm leading-relaxed text-white/50">{desc}</div>
      <div className={`mt-4 text-sm font-medium group-hover:underline ${ctaClassName}`}>{cta} →</div>
    </Link>
  );
}

export default function Home() {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#0b0710] text-white">
      {/* Arka plan ışıması */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-moka/20 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        {/* Üst tanıtım bölümü */}
        <header className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-medium text-moka">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-moka" />
            MokaSense · Moka United
          </div>
          <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            &quot;Bizim POS para saymakla{" "}
            <span className="text-moka">kalmaz, para kazandırır.&quot;</span>
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-white/70">
            Moka&apos;nın sunucularında zaten duran ödeme verisini yapay zekâyla
            yorumlayıp üye işyerlerine WhatsApp&apos;tan içgörü, semt kıyası ve
            tek-tuş aksiyon sunan asistan.
          </p>
        </header>

        {/* Problem / çözüm */}
        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="text-xs font-medium uppercase tracking-wide text-white/40">
              Problem
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Esnaf panel açmaz, Excel okumaz. Mevcut panel &quot;ne oldu?&quot;
              sorusunu cevaplar; &quot;bu ne anlama geliyor, ne yapmalıyım?&quot;
              sorusunu cevaplayan katman yoktur.
            </p>
          </div>
          <div className="rounded-2xl border border-moka/30 bg-moka/[0.07] p-6">
            <div className="text-xs font-medium uppercase tracking-wide text-moka">
              Çözüm
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/80">
              Esnaf WhatsApp&apos;ı hiç bırakmaz. MokaSense, Moka&apos;nın verisini
              esnafın diline çevirir: haftalık özet, benzer esnafla kıyas ve
              panelden yapılan işleri sohbette tek tuşla yaptırma.
            </p>
          </div>
        </section>

        {/* Üç ekran girişi */}
        <section className="mt-12">
          <div className="mb-4 text-sm font-medium text-white/40">Üç ekran · demoya buradan gir</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <EntryCard
              href="/chat"
              emoji="💬"
              title="Esnaf Deneyimi"
              desc="WhatsApp asistanı — 4 demo işletmesi, sesli + yazılı. İçgörü, kıyas ve tek-tuş aksiyon."
              cta="/chat"
              className="border-whatsapp-accent/30 bg-whatsapp-accent/10 hover:bg-whatsapp-accent/20"
              ctaClassName="text-whatsapp-accent"
            />
            <EntryCard
              href="/admin"
              emoji="📊"
              title="Moka Yönetici Paneli"
              desc="MokaSense Moka'ya ne kazandırıyor? 5 dişli KPI, 50 işyeri, çapraz satış hunisi, Moka ölçeği projeksiyonu."
              cta="/admin"
              className="border-moka/40 bg-moka/10 hover:bg-moka/20"
              ctaClassName="text-violet-300"
            />
            <EntryCard
              href="/live"
              emoji="📡"
              title="Canlı Veri Akışı"
              desc="Moka'nın işlem nabzı gerçek zamanlı akar; MokaSense sürekli izler, fırsat ve riskleri yakalar."
              cta="/live"
              className="border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
              ctaClassName="text-emerald-300"
            />
          </div>
        </section>

        {/* Mimari notu */}
        <section className="mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <div className="text-sm font-semibold text-white">
                Sayılar asla halüsinasyon görmez.
              </div>
              <p className="mt-1 text-sm leading-relaxed text-white/50">
                Deterministik analiz motoru tüm metrikleri, benchmark&apos;ı ve
                anomalileri hesaplar; yapay zekâ yalnızca bu sayıları esnafın
                diline çevirir — sayı uydurmaz.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-white/40">
              <span className="rounded-lg border border-white/10 px-3 py-1.5">Analiz Motoru</span>
              <span className="text-white/30">→</span>
              <span className="rounded-lg border border-white/10 px-3 py-1.5">Dil Katmanı (AI)</span>
              <span className="text-white/30">→</span>
              <span className="rounded-lg border border-white/10 px-3 py-1.5">WhatsApp</span>
            </div>
          </div>
        </section>

        <footer className="mt-10 flex items-center justify-between text-xs text-white/30">
          <span>Moka United FinTech Hackathon · &quot;Hack the Idea&quot;</span>
          {dataExists() && (
            <Link href="/dev" className="hover:text-white/50 hover:underline">
              🛠️ geliştirici görünümü
            </Link>
          )}
        </footer>
      </div>
    </main>
  );
}
