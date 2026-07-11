// Moka aksiyon katmanı testi (P4-A) — mock modda gerçek şema + demo link.
// Çalıştırma: npm run test:moka  (API anahtarı GEREKMEZ; canlıya gitmez.)

import {
  createPaymentLink,
  createCampaignLink,
  requestInstallment,
  getSettlement,
  getTransactionReport,
  getPeriodSummary,
  refundTransaction,
  mokaMode,
} from "./client";
import type { CreatePaymentLinkRequest, CreatePaymentLinkResponse } from "./schema";
import { detectIntent } from "../language/intent";
import { loadTransactions } from "../data";
import type { TransactionReport } from "../engine/report";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

async function main() {
  console.log(`Moka aksiyon katmanı testi (MOKA_MODE=${mokaMode()})\n`);

  // 1) Ödeme linki — gerçek şema formatı + tıklanabilir demo link
  console.log("[1] createPaymentLink (mock)");
  const pay = await createPaymentLink({ merchantId: "kasap-08", amount: 250 });
  const raw = pay.raw as { request: CreatePaymentLinkRequest; response: CreatePaymentLinkResponse };
  check("mod mock + demo işaretli", pay.mode === "mock" && pay.demo === true);
  check("başarılı", pay.ok === true);
  check("link /pay/ ile başlıyor (tıklanabilir)", !!pay.link && pay.link.startsWith("/pay/"), pay.link);
  check(
    "request GERÇEK şema: PaymentDealerAuthentication.CheckKey (64 hex)",
    /^[a-f0-9]{64}$/.test(raw.request.PaymentDealerAuthentication.CheckKey),
  );
  check(
    "request CommunicationType=3 (yalnızca link, bildirim yok)",
    raw.request.PaymentDealerRequest.CommunicationType === 3,
  );
  check(
    "request Amount + OtherTrxCode dolu",
    raw.request.PaymentDealerRequest.Amount === 250 &&
      raw.request.PaymentDealerRequest.OtherTrxCode.startsWith("MS-kasap-08-"),
  );
  check(
    "response ResultCode=Success + UserPosPaymentId (sayı)",
    raw.response.ResultCode === "Success" &&
      typeof raw.response.Data?.UserPosPaymentId === "number",
  );
  check("response.Url === outcome.link", raw.response.Data?.Url === pay.link);
  check("SAHTE 'gerçek para' iddiası YOK (mesaj demo işaretli)", pay.message.includes("(demo"));

  // 2) Kampanya linki — dürüst framing (sen paylaş)
  console.log("\n[2] createCampaignLink (mock)");
  const camp = await createCampaignLink({ merchantId: "kuafor-01", amount: 100 });
  check("kampanya linki üretildi", camp.ok && !!camp.link);
  check("mesaj 'sen paylaş' framing (müşteriye mesaj göndermeyiz)", /paylaş/i.test(camp.message));

  // 3) Stub aksiyon (taksit) — mock başarı
  console.log("\n[3] requestInstallment (mock)");
  const taksit = await requestInstallment("kasap-08");
  check("taksit talebi mock başarı + demo", taksit.ok && taksit.demo && taksit.message.includes("(demo"));

  // 4) Hakediş (bilgi) — motordan okunur
  console.log("\n[4] getSettlement (mock, motordan)");
  const hak = await getSettlement("kafe-01");
  check("hakediş bilgisi geldi", hak.ok && /net/i.test(hak.message), hak.message.slice(0, 60) + "…");

  // 5) İşlem raporu (mock) — motordan GROUNDED (bağımsız yeniden hesapla eşit)
  console.log("\n[5] getTransactionReport (mock, motordan grounded)");
  const rep = await getTransactionReport("kafe-01", "bu_hafta");
  check("rapor geldi + demo işaretli", rep.ok && rep.demo && rep.message.includes("(demo"));
  const repRaw = rep.raw as { report: TransactionReport };
  check("netCiro sayı, işlem sayısı >= 0", typeof repRaw.report.netCiro === "number" && repRaw.report.islemSayisi >= 0);
  // Bağımsız yeniden hesap → sayının uydurma değil motordan olduğunu kanıtlar.
  const txs = loadTransactions("kafe-01");
  const { start, end } = repRaw.report;
  let mCiro = 0;
  let mCount = 0;
  for (const tx of txs) {
    const d = tx.timestamp.slice(0, 10);
    if (d >= start && d <= end && tx.status === "approved" && !tx.refunded) {
      mCiro += tx.amount;
      mCount++;
    }
  }
  check(
    "ciro/adet motordan (bağımsız hesapla eşit)",
    Math.abs(mCiro - repRaw.report.netCiro) < 0.01 && mCount === repRaw.report.islemSayisi,
    `~${Math.round(mCiro)} TL / ${mCount} işlem`,
  );

  // 6) Muhasebe özeti (kapanmış ay)
  console.log("\n[6] getPeriodSummary (mock, kapanmış ay)");
  const per = await getPeriodSummary("kafe-01");
  check("muhasebe özeti geldi + demo + 'muhasebe' geçiyor", per.ok && per.demo && /muhasebe/i.test(per.message));

  // 7) İade — son işleme GROUNDED (uydurma iade yok)
  console.log("\n[7] refundTransaction (mock, son işleme bağlı)");
  const ref = await refundTransaction("kafe-01");
  check("iade son işleme bağlı + tutar + demo", ref.ok && ref.demo && /TL/.test(ref.message) && ref.message.includes("(demo"), ref.message.slice(0, 60) + "…");

  // 8) Niyet çözücü — genişletilmiş komut seti (P4-C)
  console.log("\n[8] detectIntent");
  check("'linkimi oluştur' → odeme_linki", detectIntent("linkimi oluştur").action === "odeme_linki_olustur");
  check("'taksit aç' → taksit", detectIntent("taksit açar mısın").action === "taksit_aktive_et");
  check("'ek terminal istiyorum' → ek_terminal", detectIntent("ek terminal istiyorum").action === "ek_terminal_talep");
  check("'hakedişimi göster' → bilgi (buton yok)", detectIntent("hakedişimi göster").info === "hakedis" && detectIntent("hakedişimi göster").action === null);
  check("'bugün ne sattım' → islem_raporu (dönem bugun)", detectIntent("bugün ne sattım").action === "islem_raporu" && detectIntent("bugün ne sattım").reportPeriod === "bugun");
  check("'dün kaç işlem' → islem_raporu (dönem dun)", detectIntent("dün kaç işlem yaptım").action === "islem_raporu" && detectIntent("dün kaç işlem yaptım").reportPeriod === "dun");
  check("'bu haftanın dökümü' → islem_raporu (dönem bu_hafta)", detectIntent("bu haftanın dökümü").action === "islem_raporu" && detectIntent("bu haftanın dökümü").reportPeriod === "bu_hafta");
  check("'son işlemi iade et' → iade (buton VAR)", detectIntent("son işlemi iade et").action === "iade_islemi");
  // KRİTİK GÜVENLİK: BİLGİ sorusu iade butonu TETİKLEMEZ (para hareketi yok).
  check("'iade nasıl çalışıyor' → BİLGİ, buton YOK", detectIntent("iade nasıl çalışıyor").action === null);
  check("'nasıl yani ne iadesi falan' → buton YOK", detectIntent("nasıl yani ne iadesi falan").action === null);
  check("'iade yapar mısın' → belirsiz, buton YOK", detectIntent("iade yapar mısın").action === null);
  check("sadece 'iade' → belirsiz, buton YOK", detectIntent("iade").action === null);
  check("'geri al' → iade (açık emir, buton VAR)", detectIntent("son çektiğimi geri al").action === "iade_islemi");
  check("'kartım neden geçmedi' → ret_analizi", detectIntent("kartım neden geçmedi").info === "ret_analizi");
  check("'ayın özetini çıkar' → muhasebe_ozeti", detectIntent("ayın özetini çıkar").action === "muhasebe_ozeti");
  check("'muhasebeci dökümü' → muhasebe_ozeti", detectIntent("muhasebeci dökümü lazım").action === "muhasebe_ozeti");
  check("'ne yapabilirsin' → yetenekler", detectIntent("sen ne yapabilirsin").info === "yetenekler");
  check("'kredi ver' → unsupported (yapamaz)", detectIntent("bana kredi verir misin").unsupported === true);
  check("'nakit ne kadar sattım' → unsupported (nakit görünmez)", detectIntent("nakit ne kadar sattım").unsupported === true);
  check("'hangi ürünü sattım' → unsupported (ürün görünmez)", detectIntent("bugün hangi ürünü sattım").unsupported === true);
  check("'bugün hava nasıl' → nötr (aksiyon/bilgi yok)", (() => { const d = detectIntent("bugün hava nasıl"); return !d.action && !d.info && !d.unsupported; })());

  console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("Test hatası:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
