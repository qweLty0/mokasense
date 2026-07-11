// Görüntü güvenlik ağı (P4-C kalite) — SON savunma hattı.
//
// KÖK NEDEN NOTU: Bozuk karakterlerin iki kaynağı var:
//  1) Streaming UTF-8 decode-sınır hatası → yanlış decode'da Türkçe çok-baytlı
//     harfler (ı, ğ, ü, ş, ö, ç) ağ chunk sınırında bölünüp U+FFFD (�) olur.
//     Asıl çözüm ChatClient'ta TextDecoder({stream:true}) + son flush ile yapılır.
//  2) Nadir model token glitch'i → yanıta yabancı alfabe (Japonca/Çince vb.)
//     sızabilir. Asıl çözüm effort=medium + prompttaki DİL KURALI ile yapılır.
//
// Bu fonksiyon bir "güvenlik ağı"dır: yukarıdaki çözümlere rağmen bir şey
// sızarsa kullanıcı/esnaf ekranda ASLA bozuk karakter görmesin diye görüntüden atar.
// Türkçe harfleri, rakamları, noktalamayı ve emojileri ASLA bozmaz (blocklist
// yaklaşımı — yalnızca bilinen yabancı alfabeleri ve � işaretini siler).

// Bilinen yabancı alfabeler (Türkçe metinde bulunmamalı). Latin (Türkçe dahil),
// rakam, noktalama, sembol ve emoji bu listede YOKTUR — dokunulmaz.
const FOREIGN_SCRIPTS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Armenian}\p{Script=Georgian}]/gu;

/**
 * Görüntülenecek metni son kez temizler: U+FFFD (decode artefaktı) ve yabancı
 * alfabe karakterlerini atar; kalan çift boşlukları sadeleştirir. Türkçe/emoji
 * içeriğe dokunmaz.
 */
export function sanitizeForDisplay(text: string): string {
  if (!text) return text;
  return text
    .replace(/�/g, "") // decode replacement char (�)
    .replace(FOREIGN_SCRIPTS, "") // Japonca/Çince/Kiril/... sızıntısı
    .replace(/[ \t]{2,}/g, " "); // silinenlerden kalan fazla boşluk
}
