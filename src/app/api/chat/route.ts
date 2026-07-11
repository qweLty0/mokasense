// Dil Katmanı API ucu (P3-A) — /api/chat
// Motorun hazır bulgularını (loadFindings) Claude API ile esnaf diline çevirir.
// Streaming (ReadableStream) döndürür; arayüz (P3-B) canlı "yazılıyor" efektinde
// kullanacak. Sayılar motordan gelir; AI sadece tercüman (mimari karar).

import Anthropic from "@anthropic-ai/sdk";
import { loadFindings, loadMerchants, loadTransactions, insightsExist } from "@/lib/data";
import {
  buildProactivePrompt,
  buildQAPrompt,
  deriveQAMetrics,
  type QuickFacts,
} from "@/lib/language/prompts";
import {
  lastRefundableTransaction,
  recentDeclineBreakdown,
  transactionReport,
} from "@/lib/engine/report";

// fs okuduğumuz ve akış döndürdüğümüz için Node runtime + dinamik.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dil Katmanı = Claude Sonnet 4.6. Düşünme kapalı (4.6'da varsayılan) — bu bir
// çeviri/iletişim görevi. Efor 'medium': düşük eforda (özellikle çok turlu ve
// grounded çeviride) yanıta ara sıra yabancı token / yapışık kelime sızıyordu;
// medium bu artefaktları temizliyor, ilk-token gecikmesini kabul edilebilir
// ölçüde etkiliyor. Dil kısıtı (prompts.ts DIL_KISITI) ile birlikte iki katman.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const EFFORT = "medium" as const;

type Mode = "proactive" | "qa";

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  merchantId?: string;
  mode?: Mode;
  message?: string;
  /** QA modunda o ana kadarki sohbet (model tekrar etmesin, ilerletsin). */
  history?: HistoryTurn[];
}

// İç trigger — proaktif çağrıda kullanılan kullanıcı mesajı. Geçmiş asistan
// mesajıyla başlıyorsa (proaktif özet), diziyi kurallara uygun kılmak için
// başa bu konur (Anthropic ilk mesaj 'user' olmalı).
const PROACTIVE_TRIGGER = "Bu haftaki durumumu özetler misin?";

// Sohbet geçmişini Anthropic messages dizisine çevirir (son ~20 tur, geçerli
// içerik). İlk tur asistansa başa trigger user mesajı eklenir.
function buildQAMessages(history: HistoryTurn[] | undefined, current: string) {
  const turns = (Array.isArray(history) ? history : [])
    .filter(
      (t) =>
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim().length > 0,
    )
    .slice(-20);

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  if (turns.length > 0 && turns[0].role !== "user") {
    messages.push({ role: "user", content: PROACTIVE_TRIGGER });
  }
  for (const t of turns) messages.push({ role: t.role, content: t.content });
  messages.push({ role: "user", content: current });
  return messages;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Red kodu -> esnafça açıklama (quickFacts okunur hâli için).
const DECLINE_TR: Record<string, string> = {
  yetersiz_bakiye: "yetersiz bakiye",
  limit_asimi: "limit aşımı",
  teknik: "teknik arıza",
  hatali_sifre: "hatalı şifre",
  kart_kayip_calinti: "kayıp/çalıntı kart",
  banka_reddi: "banka reddi",
};

/**
 * QA için "hızlı bilgiler" — motorun (report.ts) işlem verisinden türetilen
 * olgusal anlık görüntü. Panel-eşdeğeri istekleri (bugün ne sattım / neden
 * geçmedi / son işlemi iade et) GROUND'lamak için promptla gömülür. Sayılar
 * motordan gelir; AI üretmez.
 */
function buildQuickFacts(merchantId: string): QuickFacts {
  const txs = loadTransactions(merchantId);
  const bugun = transactionReport(txs, "bugun");
  const son = lastRefundableTransaction(txs);
  const red = recentDeclineBreakdown(txs, 14);

  const facts: QuickFacts = {
    bugun: {
      tarih: bugun.end,
      netCiro: bugun.netCiro,
      islemSayisi: bugun.islemSayisi,
      enBuyukIslem: bugun.enBuyukIslem,
      reddedilen: bugun.reddedilen,
    },
  };
  if (son) {
    facts.sonIslem = {
      tutar: son.amount,
      tarih: son.timestamp.slice(0, 10),
      kart: `${son.issuerBank} ${son.cardType}`,
      kanal: son.channel,
    };
  }
  facts.sonDonemRed = {
    gunSayisi: red.gunSayisi,
    toplamRed: red.toplamRed,
    redOrani: red.redOrani,
    enSikSebep: red.enSikSebep ? (DECLINE_TR[red.enSikSebep] ?? red.enSikSebep) : null,
    sebepler: red.sebepler,
  };
  return facts;
}

export async function POST(req: Request): Promise<Response> {
  // 1) Girdi doğrulama
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return jsonError("Geçersiz istek gövdesi (JSON bekleniyor).", 400);
  }

  const { merchantId, mode, message, history } = body;
  if (!merchantId) return jsonError("merchantId zorunlu.", 400);
  if (mode !== "proactive" && mode !== "qa") {
    return jsonError("mode 'proactive' veya 'qa' olmalı.", 400);
  }
  if (mode === "qa" && (!message || !message.trim())) {
    return jsonError("qa modunda 'message' (soru) zorunlu.", 400);
  }

  // 2) API anahtarı kontrolü — çökme değil, NET json hata (gerçeklik kuralı)
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(
      "API anahtarı eksik — .env.local'a ANTHROPIC_API_KEY ekleyin.",
      503,
    );
  }

  // 3) Motor çıktısı hazır mı?
  if (!insightsExist()) {
    return jsonError(
      "Analiz çıktısı bulunamadı — önce `npm run analyze` çalıştırın.",
      503,
    );
  }

  // 4) İşyeri + bulgular
  const merchant = loadMerchants().find((m) => m.id === merchantId);
  if (!merchant) return jsonError(`İşyeri bulunamadı: ${merchantId}`, 404);
  const findings = loadFindings(merchantId);

  // 5) Prompt kurgusu (bulgular yapılandırılmış JSON olarak gömülür)
  let system: string;
  let apiMessages: { role: "user" | "assistant"; content: string }[];
  if (mode === "proactive") {
    if (findings.length === 0) {
      return jsonError("Bu işyeri için henüz bulgu yok.", 404);
    }
    system = buildProactivePrompt(findings, merchant);
    apiMessages = [{ role: "user", content: PROACTIVE_TRIGGER }];
  } else {
    const metrics = deriveQAMetrics(findings, merchant);
    const quickFacts = buildQuickFacts(merchantId);
    system = buildQAPrompt(findings, merchant, metrics, quickFacts);
    // Konuşma geçmişini modele ver → aynı özeti tekrar etmesin, ilerletsin.
    apiMessages = buildQAMessages(history, message!.trim());
  }

  // 6) Streaming üretim
  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const anthropicStream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: "disabled" },
          output_config: { effort: EFFORT },
          system,
          messages: apiMessages,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        // Akış başladıysa HTTP durumunu değiştiremeyiz; hatayı çökme yerine
        // görünür bir işaret olarak akışa yaz (gerçeklik kuralı: sessiz değil).
        const msg = err instanceof Error ? err.message : "bilinmeyen hata";
        console.error("[/api/chat] Claude API hatası:", msg);
        controller.enqueue(encoder.encode(`\n\n⚠️ Asistan yanıtı alınamadı: ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
