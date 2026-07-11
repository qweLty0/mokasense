// Demo ödeme sayfası (P4-A) — üretilen ödeme/kampanya linkinin açtığı sayfa.
//
// Amaç: buton → link → tıklanabilir sayfa zinciri uçtan uca ÇALIŞIR görünsün
// (kullanıcı linke tıklayınca somut bir şey görür). Moka markalı görünümlü ama
// AÇIKÇA "demo" işaretli — sahte gerçek-para hareketi iddiası YOK (gerçeklik).

export const dynamic = "force-dynamic";

export default function PayPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tutar?: string; aciklama?: string };
}) {
  const tutar = searchParams.tutar ? Number(searchParams.tutar) : null;
  const aciklama = searchParams.aciklama;
  const tutarStr =
    tutar != null && !Number.isNaN(tutar) ? tutar.toLocaleString("tr-TR") : "—";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0b0f19] px-4 py-10">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Moka markalı başlık */}
        <div className="bg-moka px-6 py-5 text-white">
          <div className="text-lg font-semibold">Moka United</div>
          <div className="text-xs text-white/70">Güvenli Ödeme · Link ile Tahsilat</div>
        </div>

        {/* Demo uyarısı — dürüstlük */}
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">
          ⚠️ Bu bir <strong>demo ödeme sayfasıdır</strong> (MokaSense hackathon
          prototipi). Gerçek bir kart çekimi veya para hareketi yapılmaz.
        </div>

        {/* Tutar / açıklama */}
        <div className="px-6 py-6 text-gray-800">
          <div className="text-sm text-gray-500">Ödenecek tutar</div>
          <div className="mt-1 text-3xl font-bold text-gray-900">{tutarStr} TL</div>
          {aciklama && (
            <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {aciklama}
            </div>
          )}
          <div className="mt-4 text-xs text-gray-400">
            Ödeme No: {params.id}
          </div>

          {/* Sahte ödeme formu (görsel) */}
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
              Kart numarası · •••• •••• •••• ••••
            </div>
            <div className="flex gap-3">
              <div className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
                AA/YY
              </div>
              <div className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
                CVV
              </div>
            </div>
            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed rounded-lg bg-moka py-3 font-semibold text-white opacity-60"
            >
              Öde (demo — pasif)
            </button>
          </div>
        </div>

        <div className="border-t border-gray-100 px-6 py-3 text-center text-[11px] text-gray-400">
          Bu ekran, ödeme linki zincirinin çalıştığını göstermek için üretilmiştir.
        </div>
      </div>
    </main>
  );
}
