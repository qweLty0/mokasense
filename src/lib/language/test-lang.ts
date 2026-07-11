// Dil Katmanı doğrulama script'i (P3-A) — arayüz OLMADAN, konsoldan.
// Çalıştırma: npm run test:lang
//
// GERÇEK API anahtarı gerektirir (.env.local -> ANTHROPIC_API_KEY). Anahtar
// yoksa net uyarı verir, hata fırlatmaz. Amaç: motorun sayılarıyla mı
// konuşuyor, uydurma sayı/gün/saat var mı GÖZLE bakmak.

import Anthropic from "@anthropic-ai/sdk";
import { loadFindings, loadMerchants, loadTransactions, insightsExist } from "../data";
import { buildProactivePrompt, buildQAPrompt, deriveQAMetrics, type QuickFacts } from "./prompts";
import { capabilitiesMessage } from "./intent";
import {
  lastRefundableTransaction,
  recentDeclineBreakdown,
  transactionReport,
} from "../engine/report";

// Red kodu -> esnafça açıklama (route ile aynı; quickFacts okunur hâli).
const DECLINE_TR: Record<string, string> = {
  yetersiz_bakiye: "yetersiz bakiye",
  limit_asimi: "limit aşımı",
  teknik: "teknik arıza",
  hatali_sifre: "hatalı şifre",
  kart_kayip_calinti: "kayıp/çalıntı kart",
  banka_reddi: "banka reddi",
};

/** Route'daki buildQuickFacts ile aynı — panel-eşdeğeri istekleri GROUND'lar. */
function quickFactsFor(merchantId: string): QuickFacts {
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
    sonDonemRed: {
      gunSayisi: red.gunSayisi,
      toplamRed: red.toplamRed,
      redOrani: red.redOrani,
      enSikSebep: red.enSikSebep ? (DECLINE_TR[red.enSikSebep] ?? red.enSikSebep) : null,
      sebepler: red.sebepler,
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
  return facts;
}

const MODEL = "claude-sonnet-4-6";
// Route ile birebir aynı efor — test üretimi yansıtsın (yabancı token/yapışık
// kelime artefaktı bu ayarla temizleniyor; bkz. api/chat/route.ts EFFORT).
const EFFORT = "medium" as const;
const HERO = "kafe-01"; // Örnek kafe (Kahve Molası) — örnek anomali senaryosu

// .env.local'ı basitçe yükle (Next dışında tsx ile çalışırken gerekli).
function loadEnvLocal(): void {
  try {
    // Dinamik require: dotenv yoksa bile script çökmesin.
    const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    /* yut — env yüklenemezse aşağıdaki anahtar kontrolü uyarır */
  }
}

const line = (s = "") => console.log(s);
const rule = () => line("─".repeat(64));

type Turn = { role: "user" | "assistant"; content: string };

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function ask(system: string, userMessage: string): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { effort: EFFORT },
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  return textOf(res);
}

// Çok turlu çağrı — konuşma geçmişini modele verir. İlk tur asistansa (proaktif
// özet) route ile aynı biçimde başa trigger user mesajı konur.
async function askConvo(system: string, turns: Turn[]): Promise<string> {
  const client = new Anthropic();
  const messages: Turn[] = [];
  if (turns.length && turns[0].role !== "user") {
    messages.push({ role: "user", content: "Bu haftaki durumumu özetler misin?" });
  }
  for (const t of turns) messages.push({ role: t.role, content: t.content });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { effort: EFFORT },
    system,
    messages,
  });
  return textOf(res);
}

async function main(): Promise<void> {
  loadEnvLocal();

  if (!process.env.ANTHROPIC_API_KEY) {
    line("⚠️  ANTHROPIC_API_KEY yok. Bu test GERÇEK API anahtarı gerektirir.");
    line("   .env.local dosyasına ANTHROPIC_API_KEY=... ekleyip tekrar deneyin.");
    line("   (.env.example örnek olarak duruyor; anahtar ASLA commit edilmez.)");
    process.exit(0);
  }
  if (!insightsExist()) {
    line("⚠️  Analiz çıktısı yok. Önce: npm run datagen && npm run analyze");
    process.exit(0);
  }

  const merchant = loadMerchants().find((m) => m.id === HERO);
  if (!merchant) {
    line(`⚠️  ${HERO} bulunamadı. Önce: npm run datagen && npm run analyze`);
    process.exit(0);
  }
  const findings = loadFindings(HERO);

  line(`MokaSense Dil Katmanı testi — ${merchant.name} (${merchant.district})`);
  line(`Model: ${MODEL} · Bulgu sayısı: ${findings.length}`);
  line("Not: Sayılar/gün/saat motordan gelmeli; uydurma OLMAMALI.");
  rule();

  // (a) Proaktif haftalık mesaj — Salı-Çarş çukuru motorun sayısıyla anlatılmalı
  line("\n[a] PROAKTİF HAFTALIK MESAJ");
  rule();
  line(await ask(buildProactivePrompt(findings, merchant), "Bu haftaki durumumu özetler misin?"));

  // (b) QA — cevap veride var (anomali bulgusu kullanılmalı)
  // P4-C: quickFacts gömülü → "bugün ne sattım / neden geçmedi / iade" GROUNDED.
  const qaSystem = buildQAPrompt(
    findings,
    merchant,
    deriveQAMetrics(findings, merchant),
    quickFactsFor(HERO),
  );
  line("\n");
  rule();
  line("[b] QA — Soru: \"bu hafta neden düşük ya\"");
  rule();
  line(await ask(qaSystem, "abi bu hafta neden düşük ya"));

  // (c) QA — cevap veride YOK (geçmiş yıl); uydurmamalı, "elimde veri yok" demeli
  line("\n");
  rule();
  line("[c] QA — Soru: \"geçen yılki cirom neydi?\" (veri kapsam dışı)");
  rule();
  line(await ask(qaSystem, "geçen yılki cirom neydi?"));

  // (d) ÇOK TURLU — konuşma ilerlemeli, aynı çukur özeti TEKRARLANMAMALI
  line("\n");
  rule();
  line('[d] ÇOK TURLU — "neden düşük?" → "bakalım" → "olur" (tekrar OLMAMALI)');
  rule();

  // Gerçek akışı taklit et: önce proaktif özet (asistan turu), sonra 3 QA turu.
  const proactive = await ask(
    buildProactivePrompt(findings, merchant),
    "Bu haftaki durumumu özetler misin?",
  );
  const convo: Turn[] = [{ role: "assistant", content: proactive }];

  const turn = async (userText: string) => {
    convo.push({ role: "user", content: userText });
    const answer = await askConvo(qaSystem, convo);
    convo.push({ role: "assistant", content: answer });
    line(`\n👤 ${userText}`);
    line(`🤖 ${answer}`);
  };

  await turn("abi bu hafta neden düşük ya");
  await turn("bakalım");
  await turn("olur");

  // (e) PANEL-EŞDEĞERİ KOMUTLAR (P4-C) — quickFacts GROUNDED, keşif önerili
  line("\n");
  rule();
  line("[e] KOMUT SETİ — panel-eşdeğeri istekler (grounded + keşif önerisi)");
  rule();

  const single = async (label: string, userText: string) => {
    line(`\n👤 ${userText}   (${label})`);
    line(`🤖 ${await ask(qaSystem, userText)}`);
  };

  await single("işlem raporu", "bugün ne sattım");
  await single("ret analizi", "kartım neden geçmedi");
  await single("iade — onay istemeli", "son çektiğimi iade et");
  await single("dürüst red", "bana biraz kredi verir misin");

  // (f) YETENEK LİSTESİ — deterministik (API'siz, ChatClient'ta da böyle gösterilir)
  line("\n");
  rule();
  line('[f] YETENEK LİSTESİ — "ne yapabilirsin" (deterministik, uydurma yok)');
  rule();
  line(capabilitiesMessage());

  line("\n");
  rule();
  line("Bitti. Denetle: (a-c) uydurma sayı/tarih var mı? (a) sonunda kısa yetenek");
  line("tanıtımı geldi mi? (d) 3 cevap FARKLI/ilerleyen mi? (e) rapor/ret/iade");
  line("motor sayısıyla mı konuşuyor, iade ONAY istiyor mu, kredi DÜRÜSTÇE mi");
  line("reddediliyor, her cevap sonunda İLGİLİ 2-3 öneri var mı (spam değil)?");
}

main().catch((err) => {
  console.error("Test hatası:", err instanceof Error ? err.message : err);
  process.exit(1);
});
