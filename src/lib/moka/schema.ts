// Moka United — Ödeme İsteği Gönderme (link ile tahsilat) servisi tipleri.
//
// Kaynak: developer.mokaunited.com → "Ödeme İşlemleri / Ödeme İsteği Gönderme".
// Esnaf bir tutar için ödeme linki üretir; CommunicationType=3 seçilince Moka
// SMS/e-posta GÖNDERMEZ, yalnızca linki döner — esnaf bu linki kendi kanalından
// (WhatsApp, Instagram, kapı QR'ı) paylaşır. Bu, ürünün "son müşteriye
// doğrudan ulaşma iddiası yok" kuralıyla birebir uyumludur.
//
// Bu dosya GERÇEK API şemasıdır; canlı (live) mod tek env değişikliğiyle bu
// tiplerle service.mokaunited.com'a bağlanır.

/** Moka para birimi kodları. */
export type MokaCurrency = "TL" | "USD" | "EUR" | "GBP";

/**
 * Bildirim tipi:
 *  0 = SMS ile gönder
 *  1 = E-posta ile gönder
 *  2 = SMS + E-posta
 *  3 = Bildirim gönderme, yalnızca link üret  ← MokaSense bunu kullanır
 */
export type MokaCommunicationType = 0 | 1 | 2 | 3;

/**
 * Bayi (işyeri) kimlik doğrulaması. CheckKey, Moka'nın istediği SHA256 imzasıdır:
 *   SHA256(DealerCode + "MK" + Username + "PD" + Password)
 */
export interface PaymentDealerAuthentication {
  DealerCode: string;
  Username: string;
  Password: string;
  CheckKey: string;
}

/** Ödeme isteği gövdesi (tutar + dönüş adresi + işyeri işlem kodu). */
export interface PaymentDealerRequestData {
  Amount: number;
  Currency: MokaCurrency;
  /** Ödeme tamamlanınca yönlendirilecek URL (işyerinin dönüş adresi). */
  ClientWebUrl: string;
  /** İşyerinin kendi işlem kodu — eşleştirme/idempotency için benzersiz. */
  OtherTrxCode: string;
  CommunicationType: MokaCommunicationType;
  /** Link açıklaması (ör. "Salı-Çarşamba öğleden sonra kampanyası"). */
  Description?: string;
  SendSms: boolean;
  SendEmail: boolean;
}

/** Ödeme İsteği Gönderme — tam request zarfı. */
export interface CreatePaymentLinkRequest {
  PaymentDealerAuthentication: PaymentDealerAuthentication;
  PaymentDealerRequest: PaymentDealerRequestData;
}

/** Başarılı yanıtın Data bloğu. */
export interface CreatePaymentLinkResponseData {
  /** Moka tarafında oluşan ödeme kaydı kimliği. */
  UserPosPaymentId: number;
  /** Paylaşılacak ödeme linki. */
  Url: string;
  /** Doğrulama için hash kodu. */
  CodeForHash: string;
}

/** Moka standart sonuç kodu ("Success" veya hata kodu metni). */
export type MokaResultCode = "Success" | (string & {});

/** Moka standart yanıt zarfı (tüm servisler bu biçimi döner). */
export interface MokaResponse<T> {
  Data: T | null;
  ResultCode: MokaResultCode;
  ResultMessage: string;
  Exception: string | null;
}

export type CreatePaymentLinkResponse = MokaResponse<CreatePaymentLinkResponseData>;
