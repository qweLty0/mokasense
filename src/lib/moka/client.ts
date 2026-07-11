// Moka aksiyon istemcisi (P4-A).
//
// STRATEJİ (gerçeklik kuralı): Kod, Moka'nın GERÇEK API şemasına (schema.ts)
// birebir uygun request üretir. MOKA_MODE ile çalışma modu seçilir:
//   - 'mock' (varsayılan): CANLI sunucuya GİTMEZ. Gerçek formatta request kurar,
//     gerçekçi bir Success yanıtı simüle eder. Ödeme linki bizim tıklanabilir
//     /pay/[id] demo sayfamıza işaret eder. Yanıtlar açıkça "demo/test" işaretli;
//     sahte "gerçek para hareketi oldu" iddiası YOKTUR.
//   - 'live': service.mokaunited.com'a GERÇEK POST atar. Şimdilik çağrılmıyor
//     ama kod hazır — tek env değişikliğiyle (MOKA_MODE=live) aktif olur.
//
// Not: Bu dosya yalnızca sunucu tarafında kullanılır (node:crypto + fs).

import { createHash } from "node:crypto";
import type {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  MokaCurrency,
  PaymentDealerAuthentication,
} from "./schema";
import { loadFindings, loadTransactions } from "../data";
import {
  lastRefundableTransaction,
  periodSummary,
  transactionReport,
  type ReportPeriod,
} from "../engine/report";

export type MokaMode = "mock" | "live";

export function mokaMode(): MokaMode {
  return process.env.MOKA_MODE === "live" ? "live" : "mock";
}

function baseUrl(): string {
  // Canlı: prod. Test ortamı istenirse env ile service.refmokaunited.com verilir.
  return process.env.MOKA_BASE_URL ?? "https://service.mokaunited.com";
}

/** Bayi kimlik doğrulaması — CheckKey Moka formülüyle üretilir. */
function dealerAuth(): PaymentDealerAuthentication {
  // Boş string de (env'de "MOKA_DEALER_CODE=") demo placeholder'a düşsün.
  const DealerCode = process.env.MOKA_DEALER_CODE || "DEMO-DEALER";
  const Username = process.env.MOKA_USERNAME || "demo";
  const Password = process.env.MOKA_PASSWORD || "demo";
  // Moka: SHA256(DealerCode + "MK" + Username + "PD" + Password)
  const CheckKey = createHash("sha256")
    .update(`${DealerCode}MK${Username}PD${Password}`)
    .digest("hex");
  return { DealerCode, Username, Password, CheckKey };
}

// İşyerinin kendi işlem kodu (idempotency / eşleştirme).
function otherTrxCode(merchantId: string): string {
  return `MS-${merchantId}-${Date.now()}`;
}

// Gerçekçi görünümlü Moka ödeme kaydı kimliği (mock).
function fakePosPaymentId(): number {
  return Math.floor(100_000_000 + Math.random() * 900_000_000);
}

/**
 * Uygulama-dostu normalize sonuç. Arayüz bunu gösterir; ham Moka yanıtı `raw`da.
 */
export interface ActionOutcome {
  ok: boolean;
  mode: MokaMode;
  /** Kısa, esnaf-dostu durum metni (mock'ta "(demo)" işaretli). */
  message: string;
  /** Üretilen ödeme/kampanya linki (varsa) — tıklanabilir. */
  link?: string;
  /** Referans/kayıt no (UserPosPaymentId, destek no vb.). */
  reference?: string;
  /** Demo/test mi? (mock -> true) — sahte gerçek-para iddiası engellenir. */
  demo: boolean;
  /** Ham Moka request/response (şeffaflık + admin paneli için). */
  raw?: unknown;
}

const DEMO_TAG = "(demo · test modu)";

// ============================ ÖDEME / KAMPANYA LİNKİ =======================

export interface CreatePaymentLinkParams {
  merchantId: string;
  amount: number;
  currency?: MokaCurrency;
  description?: string;
  /** Ödeme sonrası dönüş adresi (işyerinin sitesi vb.). */
  clientWebUrl?: string;
}

/**
 * Ödeme/kampanya linki oluşturur (Moka: Ödeme İsteği Gönderme, CommunicationType=3).
 * Mock: tıklanabilir /pay/[id] demo linki döner. Live: service.mokaunited.com.
 */
export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<ActionOutcome> {
  const { merchantId, amount, currency = "TL", description, clientWebUrl } = params;

  // GERÇEK şemaya uygun request nesnesi (her iki modda da kurulur).
  const request: CreatePaymentLinkRequest = {
    PaymentDealerAuthentication: dealerAuth(),
    PaymentDealerRequest: {
      Amount: amount,
      Currency: currency,
      ClientWebUrl: clientWebUrl ?? "https://mokasense.demo/return",
      OtherTrxCode: otherTrxCode(merchantId),
      CommunicationType: 3, // yalnızca link üret, bildirim gönderme
      Description: description,
      SendSms: false,
      SendEmail: false,
    },
  };

  if (mokaMode() === "live") {
    // TODO(P4-live): Gerçek endpoint yolu Moka dokümanından teyit edilip bağlanacak.
    // Şimdilik çağrılmıyor (MOKA_MODE=mock). Şema hazır, tek env ile aktifleşir.
    const res = await fetch(`${baseUrl()}/PaymentDealer/CreatePaymentLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = (await res.json()) as CreatePaymentLinkResponse;
    const ok = data.ResultCode === "Success" && !!data.Data;
    return {
      ok,
      mode: "live",
      message: ok ? "Ödeme linki oluşturuldu." : `Moka hatası: ${data.ResultCode}`,
      link: data.Data?.Url,
      reference: data.Data ? String(data.Data.UserPosPaymentId) : undefined,
      demo: false,
      raw: { request, response: data },
    };
  }

  // --- MOCK: gerçekçi Success simülasyonu (canlı sunucuya gitmez) ---
  const id = fakePosPaymentId();
  const q = new URLSearchParams({
    tutar: String(amount),
    ...(description ? { aciklama: description } : {}),
  });
  const url = `/pay/${id}?${q.toString()}`;
  const response: CreatePaymentLinkResponse = {
    Data: { UserPosPaymentId: id, Url: url, CodeForHash: createHash("sha256").update(String(id)).digest("hex").slice(0, 24) },
    ResultCode: "Success",
    ResultMessage: "",
    Exception: null,
  };
  return {
    ok: true,
    mode: "mock",
    message: `Ödeme linkin hazır ${DEMO_TAG}. ${amount.toLocaleString("tr-TR")} ${currency} tahsilatı için müşterine bu linki gönderebilirsin.`,
    link: url,
    reference: String(id),
    demo: true,
    raw: { request, response },
  };
}

// Kampanya linki = aynı Ödeme İsteği servisi, kampanya açıklamalı.
export async function createCampaignLink(
  params: CreatePaymentLinkParams,
): Promise<ActionOutcome> {
  const out = await createPaymentLink({
    ...params,
    description: params.description ?? "MokaSense kampanya linki",
  });
  if (out.demo) {
    out.message = `Kampanya linkin hazır ${DEMO_TAG}. Sen bu linki kendi kanalından (WhatsApp, Instagram, kapı QR'ı) paylaş; biz müşteriye mesaj göndermeyiz.`;
  }
  return out;
}

// ============================ DİĞER AKSİYONLAR (stub) ======================
// Hepsi gerçek Moka servislerine karşılık gelir; mock modda gerçekçi başarı
// döner, live modda gerçek şemaya bağlanmaya hazır TODO'lu bırakılmıştır.

// Ortak stub: mock'ta başarı simüle eder, live'da bağlanacağı servisi belirtir.
async function stubAction(
  actionLabel: string,
  liveEndpointHint: string,
  successMessage: string,
): Promise<ActionOutcome> {
  if (mokaMode() === "live") {
    // TODO(P4-live): ${liveEndpointHint} servisine gerçek şemayla bağlan.
    throw new Error(`Live mod henüz bağlanmadı: ${actionLabel} (${liveEndpointHint})`);
  }
  const ref = `REQ-${Math.floor(100000 + Math.random() * 900000)}`;
  return {
    ok: true,
    mode: "mock",
    message: `${successMessage} ${DEMO_TAG}`,
    reference: ref,
    demo: true,
    raw: { note: "mock", liveEndpointHint },
  };
}

/** Taksit seçeneğini aç (Moka: Bayi/POS taksit ayarı talebi). */
export function requestInstallment(_merchantId: string): Promise<ActionOutcome> {
  return stubAction(
    "Taksit aç",
    "Dealer/POS installment-config",
    "Taksit talebin alındı; kartlı işlemlerde taksit seçeneği açılacak.",
  );
}

/** Dövizli ödemeyi aç (Moka: çoklu para birimi / dövizli tahsilat ayarı). */
export function enableForeignCurrency(_merchantId: string): Promise<ActionOutcome> {
  return stubAction(
    "Dövizli ödemeyi aç",
    "Dealer/multi-currency-config",
    "Dövizli ödeme talebin alındı; turist/yabancı kartlarda dövizli tahsilat açılacak.",
  );
}

/** Ek terminal talebi (Moka: bayi ek cihaz/terminal başvurusu). */
export function requestExtraTerminal(_merchantId: string): Promise<ActionOutcome> {
  return stubAction(
    "Ek terminal iste",
    "Dealer/terminal-request",
    "Ek terminal başvurun alındı; ekip yoğun günler için seninle iletişime geçecek.",
  );
}

/** Teknik destek kaydı aç (Moka: destek/CRM kaydı). */
export function openSupportTicket(
  _merchantId: string,
  subject = "Teknik inceleme",
): Promise<ActionOutcome> {
  return stubAction(
    `Destek kaydı: ${subject}`,
    "Support/create-ticket",
    "Destek kaydın açıldı; teknik ekip red/işlem sorununu inceleyecek.",
  );
}

/**
 * İade işlemi başlat (Moka: PaymentDealer iade servisi).
 * P4-C: Motordan (loadTransactions) iade edilebilecek EN SON işlemi bulur, iadeyi
 * o işleme GROUND'lar. Böylece esnaf "son çektiğimi geri al" dediğinde asistan
 * gerçek tutar/kart bilgisiyle konuşur; uydurma iade yapılmaz.
 * Not: Onay akışı arayüzde (buton = "onaylıyorum"); bu çağrı onay SONRASI çalışır.
 */
export async function refundTransaction(
  merchantId: string,
  _trxCode?: string,
): Promise<ActionOutcome> {
  if (mokaMode() === "live") {
    // TODO(P4-live): PaymentDealer/DoCreateRefundRequest servisine gerçek
    // şemayla (UserPaymentId / OtherTrxCode) bağlan.
    throw new Error("Live mod henüz bağlanmadı: refundTransaction (PaymentDealer/DoCreateRefundRequest)");
  }

  const tx = lastRefundableTransaction(loadTransactions(merchantId));
  if (!tx) {
    return {
      ok: false,
      mode: "mock",
      message: `İade edilebilecek uygun bir işlem bulamadım ${DEMO_TAG}.`,
      demo: true,
    };
  }

  const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");
  const ref = `RFND-${Math.floor(100000 + Math.random() * 900000)}`;
  return {
    ok: true,
    mode: "mock",
    message:
      `Tamamdır ${DEMO_TAG}. Son işlemin ${tr(tx.amount)} TL (${tx.issuerBank}, ` +
      `${tx.timestamp.slice(0, 10)}) iade sürecine alındı; tutar birkaç iş günü içinde ` +
      `müşterinin kartına döner. İşlem no: ${ref}.`,
    reference: ref,
    demo: true,
    raw: {
      note: "mock",
      liveEndpointHint: "PaymentDealer/DoCreateRefundRequest",
      refundedTransaction: { id: tx.id, amount: tx.amount, timestamp: tx.timestamp, issuerBank: tx.issuerBank },
    },
  };
}

// ============================ İŞLEM RAPORU / DÖNEM ÖZETİ ====================

const CHANNEL_TR: Record<string, string> = {
  magaza: "mağaza",
  online: "online",
  telefon: "telefon",
};

// Kanal ciro dağılımını "mağaza ~12.300 TL · online ~4.100 TL" biçiminde özetler.
function channelLine(dagilim: Record<string, number>): string {
  const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");
  const parts = Object.entries(dagilim)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${CHANNEL_TR[k] ?? k} ~${tr(v)} TL`);
  return parts.length ? parts.join(" · ") : "—";
}

/**
 * İşlem dökümü (Moka panel: işlem inceleme + Excel raporu karşılığı).
 * Mock: motorun (report.ts) deterministik hesabından esnaf-dostu döküm üretir.
 */
export async function getTransactionReport(
  merchantId: string,
  period: ReportPeriod = "bugun",
): Promise<ActionOutcome> {
  if (mokaMode() === "live") {
    // TODO(P4-live): Moka işlem listeleme/rapor servisine (PaymentDealer/GetDealerPaymentTransactionList) bağlan.
    throw new Error("Live mod henüz bağlanmadı: getTransactionReport (PaymentDealer/GetDealerPaymentTransactionList)");
  }

  const rep = transactionReport(loadTransactions(merchantId), period);
  const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");

  if (rep.islemSayisi === 0 && rep.toplamGirisim === 0) {
    return {
      ok: true,
      mode: "mock",
      message: `${rep.label[0].toUpperCase()}${rep.label.slice(1)} için kartlı işlem görünmüyor ${DEMO_TAG}.`,
      demo: true,
      raw: { report: rep },
    };
  }

  const lines = [
    `📊 ${rep.label[0].toUpperCase()}${rep.label.slice(1)} dökümü ${DEMO_TAG}`,
    `• Ciro: ~${tr(rep.netCiro)} TL (${rep.islemSayisi} işlem)`,
    `• En büyük işlem: ~${tr(rep.enBuyukIslem)} TL · ortalama fiş ~${tr(rep.ortalamaFis)} TL`,
    `• Kanal: ${channelLine(rep.kanalDagilimi)}`,
  ];
  if (rep.reddedilen > 0) lines.push(`• Reddedilen: ${rep.reddedilen} işlem`);

  return {
    ok: true,
    mode: "mock",
    message: lines.join("\n"),
    reference: `${rep.start}${rep.start === rep.end ? "" : `/${rep.end}`}`,
    demo: true,
    raw: { report: rep },
  };
}

/**
 * Ay sonu muhasebe özeti (Moka panel: ay dökümü + iade). "Muhasebecine ilet."
 * Mock: motorun (report.ts) deterministik ay hesabından metin özet üretir.
 */
export async function getPeriodSummary(
  merchantId: string,
  month?: string,
): Promise<ActionOutcome> {
  if (mokaMode() === "live") {
    // TODO(P4-live): Moka dönem/rapor servisine bağlan (statement + iade toplamı).
    throw new Error("Live mod henüz bağlanmadı: getPeriodSummary (Settlement/statement)");
  }

  const s = periodSummary(loadTransactions(merchantId), month);
  const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");
  const lines = [
    `🧾 ${s.label} muhasebe özeti ${DEMO_TAG}`,
    `• Net ciro: ~${tr(s.netCiro)} TL (${s.islemSayisi - s.iadeSayisi} işlem)`,
    `• Brüt ciro: ~${tr(s.brutCiro)} TL`,
    `• İade: ~${tr(s.iadeTutari)} TL (${s.iadeSayisi} işlem)`,
    `• Kanal: ${channelLine(s.kanalDagilimi)}`,
    `Bu özeti muhasebecine iletebilirsin; kartlı tarafın hazır.`,
  ];
  return {
    ok: true,
    mode: "mock",
    message: lines.join("\n"),
    reference: s.month,
    demo: true,
    raw: { summary: s },
  };
}

// ============================ HAKEDİŞ / EKSTRE (bilgi) =====================

/**
 * Hakediş/ekstre bilgisini getirir. Mock: motorun önceden hesapladığı hakediş
 * bulgusundan okunur (deterministik). Live: Moka hakediş/statement servisi.
 */
export async function getSettlement(merchantId: string): Promise<ActionOutcome> {
  if (mokaMode() === "live") {
    // TODO(P4-live): Moka Settlement/Statement servisine bağlan.
    throw new Error("Live mod henüz bağlanmadı: getSettlement (Settlement/statement)");
  }
  const findings = loadFindings(merchantId);
  const h = findings.find((f) => f.type === "hakedis_net")?.metrics;
  if (!h) {
    return {
      ok: false,
      mode: "mock",
      message: `Hakediş bilgisi bulunamadı ${DEMO_TAG}.`,
      demo: true,
    };
  }
  const tr = (n: number) => Math.round(n).toLocaleString("tr-TR");
  return {
    ok: true,
    mode: "mock",
    message:
      `Yarın (${h.valueDate}) hesabına net ~${tr(h.netTomorrow as number)} TL geçecek ${DEMO_TAG}. ` +
      `Bu ay şu ana kadar net ~${tr(h.monthToDateNet as number)} TL; ay sonu tahmini ~${tr(h.projectedMonthEndNet as number)} TL.`,
    reference: String(h.valueDate),
    demo: true,
    raw: { hakedis: h },
  };
}
