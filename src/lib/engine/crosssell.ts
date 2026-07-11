// Bulgu üreticisi #6 — Çapraz satış motoru (Moka ürün önerisi üreticisi).
// İçgörüden Moka ürününe köprü kuralları. SADECE ilgili ürün KAPALIYSA öner.
// Her öneri "neden şimdi, neden sen" gerekçesi taşır ve ALTIN KURAL'ın
// "So what? + Moka testi" filtresinden geçer.

import type { Merchant } from "../types";
import type { Finding, MerchantMetrics, SuggestedAction } from "./types";
import { LAST_DAY_INDEX, safeDiv, tf } from "./util";

// Moka ürün adları (merchant.activeProducts ile karşılaştırılır)
const PRODUCT = {
  DOVIZLI: "Dövizli Ödeme",
  TAKSIT: "Taksit",
  ODEME_LINKI: "Ödeme Linki",
  EK_TERMINAL: "Ek Terminal",
} as const;

// Tetik eşikleri
const FOREIGN_RECENT_MIN = 0.06; // son dönem yabancı kart payı
const PHONE_SHARE_MIN = 0.025; // telefon siparişi payı
const EK_TERMINAL_PEAK_RATIO = 1.35; // en yoğun gün / ortalama gün (işlem)
const TAKSIT_HIGH_TICKET_SHARE = 0.12; // 2×ort. fiş üstü tek çekim payı

function has(m: Merchant, product: string): boolean {
  return m.activeProducts.includes(product);
}

function make(
  m: Merchant,
  key: string,
  metrics: Finding["metrics"],
  action: SuggestedAction,
  confidence: number,
): Finding {
  return {
    id: `${m.id}:capraz_satis:${key}`,
    merchantId: m.id,
    type: `capraz_satis_${key}`,
    severity: "firsat",
    category: "capraz_satis",
    metrics,
    suggestedAction: action,
    timeframe: tf("son_donem", LAST_DAY_INDEX - 29, LAST_DAY_INDEX),
    confidence,
  };
}

/**
 * Çapraz satış önerileri. metrics'ten deterministik türetir; ürün kapalı değilse
 * ve tetik gerçek değilse öneri ÜRETMEZ (gürültü yok).
 */
export function crosssellFindings(m: Merchant, mx: MerchantMetrics): Finding[] {
  const out: Finding[] = [];

  // 1) Yabancı kart artışı → Dövizli Ödeme
  if (!has(m, PRODUCT.DOVIZLI) && mx.foreignRateRecent >= FOREIGN_RECENT_MIN) {
    const rising = mx.foreignRateRecent >= mx.foreignRateBaseline * 1.4;
    out.push(
      make(
        m,
        "dovizli",
        {
          foreignRateRecent: mx.foreignRateRecent,
          foreignRateBaseline: mx.foreignRateBaseline,
          rising,
        },
        {
          type: "dovizli_odeme_ac",
          mokaProduct: PRODUCT.DOVIZLI,
          rationale:
            `Son ayda yabancı kart payın %${(mx.foreignRateRecent * 100).toFixed(1)} ` +
            `(baz %${(mx.foreignRateBaseline * 100).toFixed(1)}). Dövizli ödeme ile ` +
            `turist müşteride daha yüksek onay ve daha az kur kaybı — hacim sana, Moka'ya kalır.`,
        },
        Math.min(1, 0.55 + mx.foreignRateRecent * 2),
      ),
    );
  }

  // 2) Telefon siparişi yoğunluğu → Ödeme Linki
  if (!has(m, PRODUCT.ODEME_LINKI) && mx.channelShare.telefon >= PHONE_SHARE_MIN) {
    out.push(
      make(
        m,
        "odeme_linki",
        {
          phoneChannelShare: mx.channelShare.telefon,
          phoneCount: mx.channelCounts.telefon,
        },
        {
          type: "odeme_linki_olustur",
          mokaProduct: PRODUCT.ODEME_LINKI,
          rationale:
            `İşlemlerin %${(mx.channelShare.telefon * 100).toFixed(1)}'i telefon siparişi. ` +
            `Ödeme linkiyle tahsilatı peşin garantiye alırsın; kapıda tahsilat riski ve ` +
            `iptal düşer.`,
        },
        Math.min(1, 0.5 + mx.channelShare.telefon * 4),
      ),
    );
  }

  // 3) Sezonsal/yoğun gün baskısı → Ek Terminal (fiziksel işyerleri)
  if (m.posType === "fiziksel" && !has(m, PRODUCT.EK_TERMINAL)) {
    const totalDowCount = mx.dowCount.reduce((a, b) => a + b, 0);
    const activeDays = mx.dowCount.filter((c) => c > 0).length || 1;
    const avgDay = totalDowCount / activeDays;
    const peakDay = Math.max(...mx.dowCount);
    const peakRatio = safeDiv(peakDay, avgDay);
    if (peakRatio >= EK_TERMINAL_PEAK_RATIO) {
      out.push(
        make(
          m,
          "ek_terminal",
          {
            busiestDow: mx.busiestDow,
            peakDayCount: peakDay,
            avgDayCount: avgDay,
            peakRatio,
          },
          {
            type: "ek_terminal_talep",
            mokaProduct: PRODUCT.EK_TERMINAL,
            rationale:
              `En yoğun günün ortalamanın ${peakRatio.toFixed(1)} katı işlem görüyor. ` +
              `Yoğun saatte tek terminal kuyruk demek; ek terminal sıra kaybını (ve ` +
              `kaçan satışı) önler.`,
          },
          Math.min(1, 0.45 + (peakRatio - 1) / 2),
        ),
      );
    }
  }

  // 4) Yüksek tutarlı tek çekim talebi → Taksit
  if (!has(m, PRODUCT.TAKSIT) && mx.sector !== "kafe") {
    // Yüksek fişli işlemleri taksit dönüştürebilir; installmentShare zaten düşükse fırsat
    const highTicketOpportunity = safeDiv(
      Math.max(0, mx.avgTicket - mx.avgTicketPrev) + mx.avgTicket,
      mx.avgTicket,
    );
    // Basit sinyal: ortalama fiş yüksek + mevcut taksit payı düşük
    const lowInstallment = mx.installmentShare < 0.15;
    const highValue = mx.avgTicket >= 600;
    if (lowInstallment && highValue && highTicketOpportunity >= TAKSIT_HIGH_TICKET_SHARE) {
      out.push(
        make(
          m,
          "taksit",
          {
            avgTicket: mx.avgTicket,
            installmentShare: mx.installmentShare,
          },
          {
            type: "taksit_aktive_et",
            mokaProduct: PRODUCT.TAKSIT,
            rationale:
              `Ortalama fişin ${Math.round(mx.avgTicket)} TL ve taksit kullanımı düşük ` +
              `(%${(mx.installmentShare * 100).toFixed(1)}). Ay sonu bütçesi sıkışan ` +
              `müşteriye taksit, sepeti bölerek satışı kurtarır.`,
          },
          0.5,
        ),
      );
    }
  }

  return out;
}
