// Streaming boru hattı + temizleyici regresyon testi (P4-C kalite) — API'SİZ.
// Çalıştırma: npm run test:pipeline
//
// İki bozulma sınıfını da kalıcı olarak korur:
//  1) Streaming UTF-8 decode-sınır hatası: byte akışını EN KÖTÜ şekilde (1-3
//     byte'lık rastgele parçalar, çok-baytlı harfleri bölerek) yeniden chunk'lar;
//     TextDecoder({stream:true}) + son flush ile decode edip kaynakla BİREBİR
//     eşleşmeli. (ChatClient bu deseni kullanır.)
//  2) Güvenlik ağı: sanitizeForDisplay yabancı alfabe ve U+FFFD'yi atmalı,
//     Türkçe harfleri/emoji'yi ASLA bozmamalı.

import { sanitizeForDisplay } from "./sanitize";

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

// ChatClient'taki decode akışını birebir taklit eder: tek decoder + stream:true
// + döngü sonunda argümansız flush.
function streamDecode(bytes: Uint8Array, rnd: () => number): string {
  const dec = new TextDecoder("utf-8");
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const step = 1 + Math.floor(rnd() * 3); // 1-3 byte: çok-baytlı harfi böler
    out += dec.decode(bytes.subarray(i, i + step), { stream: true });
    i += step;
  }
  out += dec.decode(); // flush
  return out;
}

// Deterministik PRNG (sabit seed → tekrarlanabilir test).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  console.log("Streaming pipeline + sanitize testi (API'siz)\n");

  // Türkçe karakter yoğun, emoji'li, çok-baytlı sınav metni.
  const SAMPLE =
    "Selin Hanım, bu hafta ciron geçen haftadan %54 yukarıda 🎉 " +
    "Salı–Çarşamba öğleden sonra 15:00–18:00 arası düşük; ığğüşöç çığşĞÜİÖŞÇ. " +
    "Yazman yeter 🙂 İyi kazançlar! ₺33.439 civarı.";
  const bytes = new TextEncoder().encode(SAMPLE);

  console.log("[1] Streaming decode — çok-baytlı Türkçe harfleri bölerek (100 tur)");
  let allSame = true;
  let worstFFFD = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const decoded = streamDecode(bytes, mulberry32(seed));
    if (decoded !== SAMPLE) {
      allSame = false;
      worstFFFD = Math.max(worstFFFD, (decoded.match(/�/g) || []).length);
    }
  }
  check("100 rastgele chunk bölünmesinde decode BİREBİR aynı (Türkçe bozulmuyor)", allSame, allSame ? "0 bozulma" : `bozulma var, örn. ${worstFFFD} �`);

  console.log("\n[2] Kontrast — stream:true OLMADAN (her chunk yeni decoder) bozulmalı");
  // Bu, hatalı yaklaşımın gerçekten bozduğunu kanıtlar (testin duyarlı olduğunu gösterir).
  const rnd = mulberry32(42);
  let bad = "";
  for (let i = 0; i < bytes.length; ) {
    const step = 1 + Math.floor(rnd() * 3);
    bad += new TextDecoder().decode(bytes.subarray(i, i + step)); // stream:false + yeni decoder
    i += step;
  }
  check("hatalı decode gerçekten bozuyor (� üretiyor) — test duyarlı", (bad.match(/�/g) || []).length > 0, `${(bad.match(/�/g) || []).length} �`);

  console.log("\n[3] sanitizeForDisplay — güvenlik ağı");
  check("temiz Türkçe metne dokunmuyor", sanitizeForDisplay(SAMPLE) === SAMPLE.replace(/[ \t]{2,}/g, " "));
  check("Türkçe harfler korunuyor (ığğüşöç ÇĞÜİÖŞ)", /ığğüşöç/.test(sanitizeForDisplay("ığğüşöç")) && /ÇĞÜİÖŞ/.test(sanitizeForDisplay("ÇĞÜİÖŞ")));
  check("emoji korunuyor (🎉🙂💪📊)", sanitizeForDisplay("🎉🙂💪📊") === "🎉🙂💪📊");
  check("Japonca sızıntı atılıyor (さっき)", sanitizeForDisplay("hemen さっき geldim") === "hemen  geldim".replace(/[ \t]{2,}/g, " "));
  check("Çince sızıntı atılıyor (你好)", sanitizeForDisplay("merhaba 你好 dünya").indexOf("你") === -1);
  check("Kiril sızıntı atılıyor (Привет)", sanitizeForDisplay("selam Привет").indexOf("П") === -1);
  check("U+FFFD (�) atılıyor", sanitizeForDisplay("geç�miş") === "geçmiş");
  check("rakam/noktalama/₺ korunuyor", sanitizeForDisplay("₺33.439 (%54) — güzel!") === "₺33.439 (%54) — güzel!");

  console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
  if (fail > 0) process.exitCode = 1;
}

main();
