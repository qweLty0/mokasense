// Aksiyon API'si (P4-A) — /api/action
// Chat'teki onay butonu (veya QA niyet butonu) tıklanınca çağrılır; ilgili Moka
// aksiyonunu (schema.ts/client.ts) çalıştırır. MOKA_MODE=mock varsayılan → canlı
// sunucuya gitmeden gerçekçi başarı döner (tıklanabilir demo linki dahil).

import {
  createCampaignLink,
  createPaymentLink,
  enableForeignCurrency,
  getPeriodSummary,
  getSettlement,
  getTransactionReport,
  openSupportTicket,
  refundTransaction,
  requestExtraTerminal,
  requestInstallment,
  type ActionOutcome,
} from "@/lib/moka/client";
import type { ReportPeriod } from "@/lib/engine/report";
import { loadMerchants, loadFindings } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActionBody {
  merchantId?: string;
  actionType?: string;
  params?: {
    amount?: number;
    currency?: "TL" | "USD" | "EUR" | "GBP";
    description?: string;
    /** islem_raporu için dönem ("bugun" | "dun" | "bu_hafta"). */
    period?: ReportPeriod;
    /** muhasebe_ozeti için ay ("YYYY-MM"); yoksa kapanmış son ay. */
    month?: string;
  };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Demo için makul varsayılan tutar (esnaf normalde kendi girer).
const DEFAULT_AMOUNT = 250;

/**
 * Ödeme/kampanya linki için, tutar verilmediyse işletmenin ORTALAMA FİŞİNDEN
 * mantıklı bir tutar türetir (sabit "250 TL" yerine bağlamlı, GROUND'lu değer).
 * Motorun haftalık özet bulgusundaki avgTicket kullanılır; 10'a yuvarlanır.
 */
function deriveLinkAmount(merchantId: string): number {
  const summary = loadFindings(merchantId).find((f) => f.type === "haftalik_ozet");
  const avg = summary?.metrics.avgTicket;
  if (typeof avg === "number" && avg > 0) {
    return Math.max(50, Math.round(avg / 10) * 10);
  }
  return DEFAULT_AMOUNT;
}

export async function POST(req: Request): Promise<Response> {
  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  const { merchantId, actionType, params } = body;
  if (!merchantId) return jsonError("merchantId zorunlu.", 400);
  if (!actionType) return jsonError("actionType zorunlu.", 400);

  const merchant = loadMerchants().find((m) => m.id === merchantId);
  if (!merchant) return jsonError(`İşyeri bulunamadı: ${merchantId}`, 404);

  // Link tutarı: esnaf açıkça girdiyse onu, yoksa ortalama fişten türetilen tutarı kullan.
  const amount = params?.amount ?? deriveLinkAmount(merchantId);
  const currency = params?.currency ?? "TL";
  const description = params?.description;

  try {
    let outcome: ActionOutcome;
    switch (actionType) {
      case "odeme_linki_olustur":
        outcome = await createPaymentLink({ merchantId, amount, currency, description });
        break;
      case "kampanya_linki_olustur":
        outcome = await createCampaignLink({ merchantId, amount, currency, description });
        break;
      case "taksit_aktive_et":
        outcome = await requestInstallment(merchantId);
        break;
      case "dovizli_odeme_ac":
        outcome = await enableForeignCurrency(merchantId);
        break;
      case "ek_terminal_talep":
        outcome = await requestExtraTerminal(merchantId);
        break;
      case "destek_kaydi_olustur":
        outcome = await openSupportTicket(merchantId);
        break;
      case "iade_islemi":
        outcome = await refundTransaction(merchantId);
        break;
      case "islem_raporu":
        outcome = await getTransactionReport(merchantId, params?.period ?? "bugun");
        break;
      case "muhasebe_ozeti":
        outcome = await getPeriodSummary(merchantId, params?.month);
        break;
      case "hakedis_goster":
        outcome = await getSettlement(merchantId);
        break;
      default:
        return jsonError(`Bilinmeyen aksiyon: ${actionType}`, 400);
    }
    return new Response(JSON.stringify(outcome), {
      status: outcome.ok ? 200 : 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    // Live mod bağlı değilse (stub throw) veya ağ hatasında çökme değil, net json.
    const msg = err instanceof Error ? err.message : "aksiyon hatası";
    return jsonError(msg, 502);
  }
}
