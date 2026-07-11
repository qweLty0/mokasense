// Niyet çözücü (P4-A → P4-C) — "Moka panelinden yapılabilen her şeyi WhatsApp'a".
//
// Esnafın QA mesajından İŞ YAPTIRMA / RAPOR / BİLGİ niyetini deterministik olarak
// algılar. SAF fonksiyon (node/tarayıcı bağımsız). ChatClient bununla, cevap
// sonrası ilgili aksiyon butonunu ekler veya (yetenek listesi gibi) deterministik
// içeriği yerelde gösterir. Grounding/gerçeklik: yalnızca Moka'da somut karşılığı
// olan işler; yapılamayan istekler `unsupported` işaretlenir ve dürüstçe reddedilir.

/** Çalıştırılabilir aksiyon tipleri (actions.ts / api/action ile aynı sözlük). */
export type ActionIntent =
  | "odeme_linki_olustur"
  | "kampanya_linki_olustur"
  | "taksit_aktive_et"
  | "dovizli_odeme_ac"
  | "ek_terminal_talep"
  | "destek_kaydi_olustur"
  | "iade_islemi"
  | "islem_raporu" // P4-C: işlem dökümü (panel: işlem inceleme + Excel)
  | "muhasebe_ozeti"; // P4-C: ay/dönem muhasebe özeti (panel: ay dökümü)

/** Bilgi isteği tipleri — buton değil; motordan/Dil Katmanından cevaplanır. */
export type InfoIntent =
  | "hakedis" // "yarın ne yatacak" — motordan
  | "ret_analizi" // P4-C: "kartım neden geçmedi" — motordan ret dökümü
  | "yetenekler"; // P4-C: "ne yapabilirsin" — deterministik yetenek listesi

export interface DetectedIntent {
  /** Butonla önerilecek çalıştırılabilir aksiyon (yoksa null). */
  action: ActionIntent | null;
  /** Bilgi isteği mi? — buton değil, motor/dil katmanı cevaplar. */
  info: InfoIntent | null;
  /** Yapamayacağımız bir iş mi? (kredi/finansman vb.) — dürüstçe reddedilir. */
  unsupported: boolean;
  /** Rapor niyeti için dönem ipucu (islem_raporu ile birlikte). */
  reportPeriod?: "bugun" | "dun" | "bu_hafta";
}

// Türkçe küçük harfe indir (İ/I dahil), aksanları koruyarak.
function normalize(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .trim();
}

const has = (t: string, ...kws: string[]) => kws.some((k) => t.includes(k));

/**
 * BİLGİ (açıklama) sorusu mu, yoksa KOMUT (aksiyon) mu?
 * KRİTİK GÜVENLİK: "iade nasıl çalışıyor", "ne iadesi", "taksit ne demek" gibi
 * BİLGİ soruları YANLIŞLIKLA bir aksiyon butonu (ör. gerçek iade) tetiklemesin.
 * Bu kalıplar görülürse aksiyon butonu ÇIKMAZ; Dil Katmanı sadece açıklar.
 * "son işlemi iade et", "taksit aç" gibi emir kipleri bu kalıplara UYMAZ.
 */
function isExplainQuestion(t: string): boolean {
  // Not: "açar mısın / oluşturur musun" gibi ekler Türkçede rica/emir kipidir
  // (komuttur), soru değil — bu yüzden burada YER ALMAZ. Yalnızca gerçek
  // açıklama/anlam soruları elenir.
  return has(
    t,
    "nasıl",
    "ne demek",
    "nedir",
    "ne iş",
    "ne işe",
    "ne oluyor",
    "ne iadesi",
    "neyi iade",
    "hangi iade",
    "ne kadar iade",
    "açıkla",
    "anlat",
    "ne yani",
    "yani ne",
    "ne bu",
    "bu ne",
  );
}

/**
 * Niyet algıla. Öncelik: yapılamaz > yetenek > bilgi > aksiyon. Böylece "kredi"
 * gibi istekler yanlışlıkla bir aksiyona eşleşmez; "ne yapabilirsin" de rapora
 * karışmaz.
 */
export function detectIntent(message: string): DetectedIntent {
  const t = normalize(message);
  const base: DetectedIntent = { action: null, info: null, unsupported: false };

  // 1) YAPAMAYACAĞIMIZ işler (altın kural: dürüstlük) — kredi/finansman, nakit,
  //    müşteriye doğrudan ulaşma, ürün/sepet detayı. Her şeyden önce elenir.
  if (
    has(t, "kredi", "finansman", "borç para", "nakit avans", "faiz", "kredi ver", "avans") ||
    has(t, "müşteriye mesaj", "müşterilerime mesaj", "müşteriye sms", "müşteriyi ara", "müşteriye ulaş", "müşteriye bildirim") ||
    has(t, "nakit satış", "nakit ciro", "nakit ne kadar") ||
    has(t, "hangi ürün", "ne ürün sat", "hangi ürünü", "sepet", "ürün detay")
  ) {
    return { ...base, unsupported: true };
  }

  // 2) YETENEK KEŞFİ — esnaf ne yapabileceğini bilmiyor; kategorili liste ister.
  if (
    has(t, "ne yapabilirsin", "neler yapabilirsin", "ne yapabiliyorsun", "neler yapabiliyorsun") ||
    has(t, "yardım et", "yardım", "neler var", "nasıl kullan", "komutlar", "ne işe yarıyorsun", "ne işe yararsın")
  ) {
    return { ...base, info: "yetenekler" };
  }

  // 3) BİLGİ istekleri (motor/dil katmanı cevaplar, buton yok)
  if (has(t, "hakediş", "hakedis", "ne yatacak", "hesabıma ne", "hesabıma geçecek", "ekstre", "para ne zaman", "ne zaman yatacak"))
    return { ...base, info: "hakedis" };
  if (
    has(t, "neden geçmedi", "niye geçmedi", "geçmedi", "geçmiyor", "geçmez", "reddedil", "onaylanmadı", "onaylanmıyor") ||
    has(t, "çalışmadı", "çalışmıyor", "başarısız", "hata kodu", "declined", "kartı niye", "kart niye")
  )
    return { ...base, info: "ret_analizi" };

  // 3.5) BİLGİ (açıklama) SORUSU → aksiyon butonu ÇIKARMA (kritik güvenlik).
  //   Esnaf "iade nasıl çalışıyor / ne iadesi / taksit ne demek" gibi bir SORU
  //   sorduysa, bu bir KOMUT değildir: gerçek bir iade/aktivasyon tetiklenmemeli.
  //   Dil Katmanı bunu sadece açıklar. Emir kipleri ("son işlemi iade et",
  //   "taksit aç") bu kalıba uymadığı için butonlarını korur.
  //   Not: rapor/döküm ("bugün ne sattım") emir sayılır, burada elenmez.
  if (isExplainQuestion(t)) return base;

  // 4) MUHASEBE/DÖNEM özeti (önce — "döküm" kelimesi rapora karışmasın)
  if (
    has(t, "muhasebe", "ay özet", "ayın özet", "ay sonu", "aylık özet", "aylık döküm", "ay dökümü", "ayın döküm", "aylık rapor", "ayın rapor", "dönem özet")
  )
    return { ...base, action: "muhasebe_ozeti" };

  // 5) İŞLEM RAPORU / DÖKÜM (panel: işlem inceleme + Excel)
  if (
    has(t, "ne sattım", "kaç sattım", "kaç işlem", "kaç para", "ne kadar sattım", "satış raporu", "günün döküm", "haftanın döküm", "işlem döküm", "döküm çıkar", "rapor çıkar", "ciro ne", "bugün ne", "dün ne", "kaç lira")
  ) {
    const reportPeriod: DetectedIntent["reportPeriod"] = has(t, "dün")
      ? "dun"
      : has(t, "hafta")
        ? "bu_hafta"
        : "bugun";
    return { ...base, action: "islem_raporu", reportPeriod };
  }

  // 6) İADE (panel: kısmi/tam iade) — GERİ ALINAMAZ PARA HAREKETİ, KATI kontrol.
  //   Buton yalnızca AÇIK EMİR kipinde çıkar ("son işlemi iade et", "geri al").
  //   Sadece "iade" geçen belirsiz/soru kipli mesajlarda buton ÇIKMAZ; Dil
  //   Katmanı önce netleştirir ("hangi işlemi geri alayım?"). Böylece müşterinin
  //   parası yanlışlıkla iade edilmez.
  if (has(t, "iade", "geri iade", "geri ödeme", "para iade", "geri al", "geri ver")) {
    const iadeCommand = has(
      t,
      "iade et",
      "iadesini",
      "iade yap",
      "iade başlat",
      "iade istiyorum",
      "iade edelim",
      "iade edeyim",
      "geri al",
      "geri ver",
      "geri öde",
      "para iade",
    );
    const softAsk = has(t, "misin", "musun", "mısın", "olur mu", "mümkün mü", "acaba", "yapabilir");
    if (iadeCommand && !softAsk) return { ...base, action: "iade_islemi" };
    return base; // belirsiz/rica kipli iade → buton yok, önce netleştir
  }

  // 7) Diğer çalıştırılabilir aksiyonlar
  if (has(t, "kampanya"))
    return { ...base, action: "kampanya_linki_olustur" };
  if (has(t, "link", "tahsilat", "ödeme iste", "para iste", "ödeme al"))
    return { ...base, action: "odeme_linki_olustur" };
  if (has(t, "taksit"))
    return { ...base, action: "taksit_aktive_et" };
  if (has(t, "döviz", "dovizli", "dövizli", "yabancı kart", "turist", "dolar", "euro"))
    return { ...base, action: "dovizli_odeme_ac" };
  if (has(t, "ek terminal", "ikinci terminal", "yeni terminal", "cihaz iste", "pos iste"))
    return { ...base, action: "ek_terminal_talep" };
  if (has(t, "destek", "arıza", "şikayet", "sorun kaydı", "teknik ekip"))
    return { ...base, action: "destek_kaydi_olustur" };

  // 8) Hiçbiri — normal içgörü sorusu
  return base;
}

// =========================================================================
// YETENEK KATALOĞU (proaktif keşif) — esnaf ne yapabileceğini bilmese bile
// asistan ona yol gösterir. Deterministik içerik: Dil Katmanı bunları uydurmaz,
// buradan okur. Her yetenek Moka panelinde somut karşılığı olan bir işe denk gelir.
// =========================================================================

export interface CapabilityItem {
  label: string;
  example: string; // esnafın yazabileceği örnek komut
}

export interface CapabilityGroup {
  emoji: string;
  title: string;
  items: CapabilityItem[];
}

// SIRA ÖNEMLİ: En özgün değerimiz (benchmark + sadakat) EN ÜSTTE. Esnafın kendi
// başına ASLA göremeyeceği şeyler önce; panel-eşdeğeri işler sonra.
export const CAPABILITIES: CapabilityGroup[] = [
  {
    emoji: "🔍",
    title: "İşini Anla",
    items: [
      { label: "Semtindeki benzer esnafla kıyas (ciro büyümesi, ort. fiş, sadakat)", example: "diğer kasaplara göre neredeyim" },
      { label: "Müşteri sadakati & kaybolan müdavimler", example: "sadık müşterilerim geliyor mu" },
      { label: "Düşüş / anomali tespiti", example: "bu hafta niye düşük" },
      { label: "En yoğun gün ve saatin", example: "en çok ne zaman satıyorum" },
      { label: "Turist / yabancı kart sinyali", example: "yabancı kart geliyor mu" },
    ],
  },
  {
    emoji: "📊",
    title: "Satış & Rapor",
    items: [
      { label: "Günlük/haftalık işlem dökümü", example: "bugün ne sattım" },
      { label: "Trend ve haftalık özet", example: "bu hafta nasıl gidiyor" },
      { label: "Ay sonu nakit akışı tahmini", example: "ay sonu ne beklerim" },
    ],
  },
  {
    emoji: "🔄",
    title: "İşlem & İade",
    items: [
      { label: "İşlem iadesi (son çektiğin)", example: "son işlemi iade et" },
      { label: "Ret/hata analizi", example: "kartım neden geçmedi" },
    ],
  },
  {
    emoji: "💰",
    title: "Para & Muhasebe",
    items: [
      { label: "Hakediş (yarın ne yatacak)", example: "hesabıma ne geçecek" },
      { label: "Ay sonu muhasebe özeti", example: "ayın özetini çıkar" },
    ],
  },
  {
    emoji: "🔗",
    title: "Tahsilat & Ayarlar",
    items: [
      { label: "Ödeme linki / kampanya linki", example: "ödeme linki oluştur" },
      { label: "Taksit / dövizli ödeme açma", example: "dövizli ödeme aç" },
      { label: "Ek terminal / teknik destek", example: "ek terminal istiyorum" },
    ],
  },
];

/** Yetenek listesini WhatsApp mesajı biçiminde üretir (deterministik, sabit). */
export function capabilitiesMessage(): string {
  const lines: string[] = [
    "Bana buradan yazıp şunları yaptırabilirsin 👇",
    "",
  ];
  for (const g of CAPABILITIES) {
    lines.push(`${g.emoji} **${g.title}**`);
    for (const it of g.items) {
      lines.push(`• ${it.label} — _“${it.example}”_`);
    }
    lines.push("");
  }
  lines.push("Yazabilir ya da sesli mesaj atabilirsin; gerisini ben hallederim.");
  return lines.join("\n");
}
