# Analiz Motoru (`src/lib/engine/`)

mimari karar gereği bu katman **%100 deterministik TypeScript — sıfır AI**.
Tüm metrikler, benchmark, anomali tespiti, sadakat döngüsü ve hakediş hesabı
burada yapılır; çıktı yapılandırılmış **`Finding`** nesneleridir. Sayılar HAM
(yuvarlanmamış) durur — formatlama ve esnaf-dili mesaj P3 (Dil Katmanı) işidir.

> "Sayılar asla halüsinasyon görmez; AI sadece tercüman ve iletişimcidir."

## Akış

```
ham işlemler ──(bir kez oku)──► computeMerchantMetrics ──► MerchantMetrics
                                          │
                                          ├─ summary.ts     → haftalık özet, trend, yoğunluk
                                          ├─ benchmark.ts   → anonim sektör/semt percentile
                                          ├─ loyalty.ts     → tekrar müşteri + kayıp sadık (akran-göreli)
                                          ├─ anomaly.ts     → ciro dip (z-testi) / red / iade
                                          ├─ settlement.ts  → net hakediş + ay sonu projeksiyon
                                          └─ crosssell.ts   → Moka ürün köprüleri (kapalı ürün + tetik)
                                          ▼
                                    index.ts (sırala) ──► Finding[]
```

## Modüller

| Dosya | Sorumluluk |
|---|---|
| `types.ts` | `Finding`, `MerchantMetrics`, `Severity`/`Category` tipleri |
| `util.ts` | Zaman ekseni (dayIndex) + saf istatistik (medyan, percentile, stdev) |
| `metrics.ts` | Tek geçişte agrega + müşteri haritası + kayıp sadık tespiti |
| `summary.ts` `benchmark.ts` `loyalty.ts` `anomaly.ts` `settlement.ts` `crosssell.ts` | Bulgu üreticileri (saf fonksiyonlar) |
| `index.ts` | Orchestrator: bir merchant için tüm üreticiler → sıralı `Finding[]` |
| `run.ts` | Toplu ön-hesap → `src/data/insights/*.json` (runtime 132MB okumaz) |
| `engine.test.ts` | Kritik hesapların unit testleri |

## Komutlar

```bash
npm run analyze       # tüm işyerleri için bulguları hesaplar, diske yazar + doğrular
npm run test:engine   # kritik saf hesapların unit testleri
```

## Performans

`run.ts` iki faz çalışır: (1) her işyerinin metriğini hesaplayıp benchmark havuzunu
kurar, (2) bulguları üretip `src/data/insights/{merchantId}.json` içine yazar.
Runtime (P3/P4) `src/lib/data.ts` → `loadFindings()` ile bu hafif dosyaları okur;
ham işlem dosyaları (~132MB) her istekte okunmaz.

## Doğrulanan planlı senaryolar

`npm run analyze` sonunda konsola bası­lır: örnek kafe Salı-Çarş 14-17 çukuru,
e-ticaret red patlaması (tek banka + teknik), e-ticaret iade anomalisi (750-900 TL
bandı), kuaför sadakat kaybı (~13 müşteri) ve örnek benchmark percentile'ı.
