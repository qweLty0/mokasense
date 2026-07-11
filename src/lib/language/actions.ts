// Aksiyon Katmanı — köprü verisi (P3-A).
// Motorun ürettiği Finding.suggestedAction'ı, arayüzde gösterilecek "onay
// butonu" verisine çevirir. Esnaf tek tuşla onaylasın diye label esnaf dilinde.
//
// MİMARİ NOT: Burada GERÇEK bir Moka API çağrısı YOKTUR. Bu katman yalnızca
// butonun taşıyacağı meta veriyi üretir; onay akışı ve gerçek entegrasyon P4'te
// (Moka test ortamı — service.refmokaunited.com) gelecek. Gerçeklik kuralı
// gereği mock'a sessizce düşmeyiz; P4 bağlanana kadar buton "test ortamı
// bekleniyor" durumunda kalır.

import type { Finding, SuggestedAction } from "../engine/types";

/** Arayüzün onay butonunu çizmesi için gereken yapılandırılmış veri. */
export interface ActionButton {
  /** Butonun bağlı olduğu bulgu (arayüz eşlemesi için). */
  findingId: string;
  /** Esnaf dilinde buton etiketi (tek tuş: "Kur", "Aç" vb.). */
  label: string;
  /** Motorun ürettiği ham aksiyon tipi (P4 bunu yorumlayacak). */
  actionType: string;
  /** İlgili Moka ürünü; ürün bağımsız aksiyonlarda (ör. destek kaydı) null. */
  mokaProduct: string | null;
  /** "Neden şimdi, neden sen" olgusal gerekçesi (motordan gelir). */
  rationale: string;
  /** Aksiyona özel parametreler (ör. rapor dönemi, muhasebe ayı). */
  params?: { period?: "bugun" | "dun" | "bu_hafta"; month?: string };
}

// Aksiyon tipini esnaf dilinde kısa, tek-tuşluk etikete çevirir.
// Bilinmeyen tip gelirse mokaProduct'tan makul bir etiket türetilir.
const LABEL_BY_ACTION: Record<string, string> = {
  dovizli_odeme_ac: "Dövizli ödemeyi aç",
  odeme_linki_olustur: "Ödeme linki oluştur",
  kampanya_linki_olustur: "Kampanya linki oluştur",
  ek_terminal_talep: "Ek terminal iste",
  taksit_aktive_et: "Taksiti aç",
  destek_kaydi_olustur: "Destek kaydı aç",
  iade_islemi: "İadeyi onayla",
  islem_raporu: "Dökümü çıkar",
  muhasebe_ozeti: "Ay özetini çıkar",
};

function labelFor(action: SuggestedAction): string {
  const known = LABEL_BY_ACTION[action.type];
  if (known) return known;
  if (action.mokaProduct) return `${action.mokaProduct}'ı aç`;
  return "Uygula";
}

/** Aksiyon tipinden esnaf-dostu etiket (niyet-güdümlü butonlar için). */
export function labelForActionType(actionType: string): string {
  return LABEL_BY_ACTION[actionType] ?? "Uygula";
}

/** Tek bir bulgunun aksiyon butonu verisini üretir (aksiyon yoksa null). */
export function buildActionButton(finding: Finding): ActionButton | null {
  const action = finding.suggestedAction;
  if (!action) return null;
  return {
    findingId: finding.id,
    label: labelFor(action),
    actionType: action.type,
    mokaProduct: action.mokaProduct,
    rationale: action.rationale,
  };
}

/**
 * Bir bulgu listesindeki tüm önerilebilir aksiyonların buton verisini üretir.
 * Bulgular zaten ciddiyete göre sıralı geldiği için butonlar da o sırada döner.
 */
export function buildActionButtons(findings: Finding[]): ActionButton[] {
  const buttons: ActionButton[] = [];
  for (const f of findings) {
    const b = buildActionButton(f);
    if (b) buttons.push(b);
  }
  return buttons;
}

// TODO(P4): Onay geldiğinde bu buton verisini Moka test API'sine bağla.
//   - actionType "odeme_linki_olustur"    -> POST ödeme linki (service.refmokaunited.com)
//   - actionType "kampanya_linki_olustur" -> POST indirimli kampanya linki (aynı link servisi)
//   - actionType "dovizli_odeme_ac" / "taksit_aktive_et" -> ilgili ürün aktivasyonu
//   - actionType "destek_kaydi_olustur"   -> destek/teknik kayıt
// API erişimi gecikirse arayüzde "test ortamı bağlantısı bekleniyor" göster;
// mock'a SESSİZCE geçme (gerçeklik kuralı).
