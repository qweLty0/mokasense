// Deterministik sözde-rastgele sayı üreteci (seed sabit → her çalıştırmada aynı veri).
// mulberry32: hızlı, kaliteli dağılım, harici bağımlılık gerektirmez.

export class Rng {
  private state: number;

  constructor(seed: number) {
    // 32-bit'e sıkıştır
    this.state = seed >>> 0;
  }

  /** [0, 1) aralığında düzgün (uniform) rastgele sayı. */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) aralığında düzgün float. */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] aralığında tam sayı (her iki uç dahil). */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** p olasılıkla true. */
  bool(p: number): boolean {
    return this.next() < p;
  }

  /** Diziden rastgele bir eleman. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Ağırlıklı seçim. weights ve items aynı uzunlukta olmalı. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Standart normal (Box-Muller). */
  gauss(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Lognormal dağılım — sepet tutarları için gerçekçi (çok sayıda küçük,
   * az sayıda büyük harcama). median: medyan tutar, sigma: yayılım.
   */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.gauss());
  }
}
