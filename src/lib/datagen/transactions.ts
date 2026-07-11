// Bir işyeri için gerçekçi işlem akışı üretir. Tüm sektörel desenler, maaş günü
// etkisi, sadık müşteri döngüleri ve işaretli anomaliler burada uygulanır.

import type {
  CardSegment,
  CardType,
  Channel,
  DeclineReason,
  Merchant,
  Transaction,
} from "../types";
import { Rng } from "./rng";
import {
  BANKS,
  DATE_END,
  DATE_START,
  FOREIGN_ISSUERS,
  SECTOR_PROFILES,
  SEGMENTS,
  SEGMENT_WEIGHTS,
  TZ_OFFSET,
} from "./config";
import { eachDay, paydayMultiplier } from "./dates";
import { ANOMALY } from "./merchants";

const DECLINE_REASONS: DeclineReason[] = [
  "yetersiz_bakiye",
  "limit_asimi",
  "banka_reddi",
  "hatali_sifre",
  "teknik",
  "kart_kayip_calinti",
];
const DECLINE_WEIGHTS = [35, 15, 20, 15, 10, 5];

/** Sadık müşteri kaydı (havuzda kalıcı, token sabit). */
interface LoyalCustomer {
  token: string;
  issuerBank: string;
  cardType: CardType;
  cardSegment: CardSegment;
  spendFactor: number; // kişisel harcama çarpanı
  cycleDays: number; // ortalama ziyaret döngüsü
  lastVisitDay: number; // en son ziyaret gün indeksi (-1 = hiç)
  churned: boolean; // kayıp anomalisine dahil mi
}

/** Saat ağırlıklarından rastgele saat seçer. */
function pickHour(rng: Rng, weights: number[]): number {
  return rng.weighted(
    Array.from({ length: 24 }, (_, h) => h),
    weights,
  );
}

function pickCardType(rng: Rng, online: boolean): CardType {
  return online
    ? rng.weighted(["credit", "debit", "prepaid"], [60, 30, 10])
    : rng.weighted(["credit", "debit", "prepaid"], [45, 50, 5]);
}

function segmentAmountFactor(seg: CardSegment): number {
  switch (seg) {
    case "gold":
      return 1.15;
    case "platinum":
      return 1.4;
    case "business":
      return 1.5;
    default:
      return 1.0;
  }
}

/**
 * Bir işyerinin tüm işlem geçmişini üretir.
 * Not: Fonksiyon saftır — aynı seed + aynı merchant → aynı çıktı.
 */
export function generateTransactions(
  merchant: Merchant,
  seed: number,
): Transaction[] {
  const profile = SECTOR_PROFILES[merchant.sector];
  const online = profile.primaryChannel === "online";
  // Her işyerine kendi deterministik RNG'si (id'den türetilmiş tohum).
  let h = seed >>> 0;
  for (let i = 0; i < merchant.id.length; i++) {
    h = (Math.imul(h, 31) + merchant.id.charCodeAt(i)) >>> 0;
  }
  const rng = new Rng(h);

  const tags = merchant.anomalyTags ?? [];
  const hasTag = (t: string) => tags.includes(t);

  const days = eachDay(DATE_START, DATE_END);
  const lastDayIndex = days.length - 1;

  // Anomali pencere sınırları (gün indeksleri)
  const heroDipStart = lastDayIndex - 20; // son 3 hafta (Salı-Çarş 14-16)
  const declineWindowStart = lastDayIndex - 3; // son 4 gün
  const refundWindowStart = lastDayIndex - 24; // son ~3.5 hafta
  const foreignWindowStart = lastDayIndex - 29; // son ~1 ay
  const churnCutoff = lastDayIndex - 55; // son 8 hafta sadıklar kaybolur
  const DECLINE_BANK = "Garanti BBVA"; // red patlamasının yoğunlaştığı banka

  // --- Sadık müşteri havuzunu kur ------------------------------------------
  const [cw0, cw1] = profile.loyalCycleWeeks;
  const loyal: LoyalCustomer[] = [];
  for (let i = 0; i < profile.loyalPoolSize; i++) {
    loyal.push({
      token: `tok-L-${merchant.id}-${i}`,
      issuerBank: rng.pick(BANKS),
      cardType: pickCardType(rng, online),
      cardSegment: rng.weighted(SEGMENTS, SEGMENT_WEIGHTS),
      spendFactor: rng.lognormal(1, 0.25),
      cycleDays: rng.int(cw0 * 7, cw1 * 7),
      lastVisitDay: -1,
      churned: false,
    });
  }
  // Kuaför kayıp anomalisi: 13 sadık müşteriyi churn setine al.
  if (hasTag(ANOMALY.LOYAL_CHURN)) {
    for (let i = 0; i < 13 && i < loyal.length; i++) loyal[i].churned = true;
  }

  const txs: Transaction[] = [];
  let newCounter = 0;

  for (const day of days) {
    const dowMult = profile.dowMultiplier[day.dow];
    const payMult = paydayMultiplier(day.dayOfMonth);
    const noise = rng.float(0.82, 1.18);
    let target = Math.round(profile.baseDailyTx * dowMult * payMult * noise);
    if (target < 0) target = 0;

    // Sadıkların "bugün ziyarete uygun" olanları (döngüsü dolmuş).
    for (let t = 0; t < target; t++) {
      const hour = pickHour(rng, profile.hourWeights);

      // Örnek kafe çukuru: son 3 hafta, Salı(2)/Çarşamba(3), 14-16 saatleri.
      if (
        hasTag(ANOMALY.HERO_CAFE) &&
        day.index >= heroDipStart &&
        (day.dow === 2 || day.dow === 3) &&
        hour >= 14 &&
        hour <= 16 &&
        !rng.bool(0.35) // işlemlerin ~%65'ini düşür
      ) {
        continue;
      }

      const minute = rng.int(0, 59);
      const second = rng.int(0, 59);
      const timestamp = `${day.dateStr}T${String(hour).padStart(2, "0")}:${String(
        minute,
      ).padStart(2, "0")}:${String(second).padStart(2, "0")}${TZ_OFFSET}`;

      // --- Yabancı kart kararı --------------------------------------------
      let foreignProb = 0.03;
      if (hasTag(ANOMALY.FOREIGN_TREND) && day.index >= foreignWindowStart) {
        const p = (day.index - foreignWindowStart) / (lastDayIndex - foreignWindowStart);
        foreignProb = 0.03 + p * 0.07; // %3 → %10
      }
      const isForeign = rng.bool(foreignProb);

      // --- Müşteri/kart seçimi --------------------------------------------
      let token: string;
      let issuerBank: string;
      let cardType: CardType;
      let cardSegment: CardSegment;
      let cardOrigin: "domestic" | "foreign";
      let spendFactor: number;

      if (isForeign) {
        // Turist/yabancı: yeni kart, yurt dışı issuer.
        newCounter++;
        token = `tok-F-${merchant.id}-${newCounter}`;
        issuerBank = rng.pick(FOREIGN_ISSUERS);
        cardType = "credit";
        cardSegment = rng.weighted(SEGMENTS, [40, 30, 20, 10]);
        cardOrigin = "foreign";
        spendFactor = rng.lognormal(1.1, 0.3);
      } else if (rng.bool(profile.loyalShare)) {
        // Sadık havuzdan seç: döngüsü dolmuş ve kaybolmamış olanları tercih et.
        const eligible = loyal.filter(
          (c) =>
            !(c.churned && day.index >= churnCutoff) &&
            (c.lastVisitDay < 0 || day.index - c.lastVisitDay >= c.cycleDays),
        );
        const pool =
          eligible.length > 0
            ? eligible
            : loyal.filter((c) => !(c.churned && day.index >= churnCutoff));
        if (pool.length === 0) {
          // Tüm sadıklar kaybolmuşsa yeni müşteriye düş.
          newCounter++;
          token = `tok-N-${merchant.id}-${newCounter}`;
          issuerBank = rng.pick(BANKS);
          cardType = pickCardType(rng, online);
          cardSegment = rng.weighted(SEGMENTS, SEGMENT_WEIGHTS);
          cardOrigin = "domestic";
          spendFactor = rng.lognormal(1, 0.3);
        } else {
          const c = pool[rng.int(0, pool.length - 1)];
          c.lastVisitDay = day.index;
          token = c.token;
          issuerBank = c.issuerBank;
          cardType = c.cardType;
          cardSegment = c.cardSegment;
          cardOrigin = "domestic";
          spendFactor = c.spendFactor;
        }
      } else {
        // Yeni/tek seferlik yerli müşteri.
        newCounter++;
        token = `tok-N-${merchant.id}-${newCounter}`;
        issuerBank = rng.pick(BANKS);
        cardType = pickCardType(rng, online);
        cardSegment = rng.weighted(SEGMENTS, SEGMENT_WEIGHTS);
        cardOrigin = "domestic";
        spendFactor = rng.lognormal(1, 0.3);
      }

      // --- Tutar -----------------------------------------------------------
      const raw =
        rng.lognormal(profile.basketMedian, profile.basketSigma) *
        spendFactor *
        segmentAmountFactor(cardSegment) *
        payMult; // maaş günü sepeti de biraz şişer
      const amount = Math.round(Math.max(15, raw) * 100) / 100;

      // --- Kanal -----------------------------------------------------------
      let channel: Channel;
      if (online) channel = "online";
      else if (profile.phoneOrderProb > 0 && rng.bool(profile.phoneOrderProb))
        channel = "telefon";
      else channel = "magaza";

      // --- Taksit ----------------------------------------------------------
      let installments = 1;
      if (amount > profile.basketMedian && rng.bool(profile.installmentProb)) {
        installments = rng.pick([2, 3, 6, 9]);
      }

      // --- Temassız --------------------------------------------------------
      const contactless =
        channel === "magaza" && amount < 1500 && rng.bool(profile.contactlessProb);

      // --- Durum (red) -----------------------------------------------------
      let status: "approved" | "declined" = "approved";
      let declineReason: DeclineReason | null = null;

      let declineRate = profile.baseDeclineRate;
      let forceTeknik = false;
      // e-ticaret red patlaması: son 4 gün, tek bankada, teknik kod, %8→%24.
      if (hasTag(ANOMALY.DECLINE_SPIKE) && day.index >= declineWindowStart) {
        const p = (day.index - declineWindowStart) / (lastDayIndex - declineWindowStart || 1);
        const targetRate = 0.08 + p * 0.16; // %8 → %24
        if (issuerBank === DECLINE_BANK) {
          declineRate = 0.9; // hedef banka işlemleri çakılıyor
          forceTeknik = true;
        } else {
          declineRate = targetRate * 0.4; // genel hafif artış
        }
      }

      if (rng.bool(declineRate)) {
        status = "declined";
        declineReason = forceTeknik
          ? "teknik"
          : rng.weighted(DECLINE_REASONS, DECLINE_WEIGHTS);
      }

      // --- İade (yalnızca onaylı işlemler) --------------------------------
      let refunded = false;
      if (status === "approved") {
        let refundRate = profile.baseRefundRate;
        // e-ticaret iade patlaması: son ~3.5 hafta, 750-900 TL bandı, %3→%11.
        if (
          hasTag(ANOMALY.REFUND_SPIKE) &&
          day.index >= refundWindowStart &&
          amount >= 750 &&
          amount <= 900
        ) {
          const p =
            (day.index - refundWindowStart) / (lastDayIndex - refundWindowStart || 1);
          refundRate = 0.08 + p * 0.12; // bu bantta iade olasılığı yüksek
        }
        refunded = rng.bool(refundRate);
      }

      txs.push({
        id: `${merchant.id}-${day.index}-${t}`,
        merchantId: merchant.id,
        timestamp,
        amount,
        cardToken: token,
        cardType,
        cardOrigin,
        issuerBank,
        cardSegment,
        installments,
        channel,
        status,
        declineReason,
        refunded,
        contactless,
      });
    }
  }

  // Zaman sırasına göre sırala (gün içi saatler karışık üretildi).
  txs.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return txs;
}
