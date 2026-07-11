// Sesli giriş — Web Speech API sarmalayıcısı (P3-B).
// Türk esnafı yazmaz, konuşur (ürün gereksinimi). Mikrofona basınca tr-TR
// konuşmayı metne çevirir. Tarayıcı desteklemiyorsa null döner → arayüz mikrofonu
// gizler, ÇÖKMEZ (graceful degrade).

// --- Web Speech API minimal tipleri (lib.dom bunları standart sunmuyor) -----
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly length: number;
  readonly isFinal: boolean;
  0: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRConstructor = new () => SpeechRecognitionInstance;

function getConstructor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Tarayıcı sesli girişi destekliyor mu? (mikrofon butonunu göstermek için) */
export function isVoiceSupported(): boolean {
  return getConstructor() !== null;
}

export interface VoiceHandlers {
  /** Ara sonuç (konuşurken canlı metin) — input'a yazmak için. */
  onPartial?: (text: string) => void;
  /** Kesinleşmiş sonuç. */
  onFinal: (text: string) => void;
  /** Hata (izin reddi, ağ vb.). */
  onError?: (error: string) => void;
  /** Dinleme bittiğinde. */
  onEnd?: () => void;
}

export interface VoiceController {
  start: () => void;
  stop: () => void;
}

/**
 * tr-TR tanıyıcı oluşturur. Desteklenmiyorsa null döner (arayüz mikrofonu gizler).
 */
export function createVoiceRecognizer(
  handlers: VoiceHandlers,
): VoiceController | null {
  const Ctor = getConstructor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "tr-TR";
  rec.continuous = false;
  rec.interimResults = true;

  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim && handlers.onPartial) handlers.onPartial(interim);
    if (final) handlers.onFinal(final);
  };
  rec.onerror = (e) => handlers.onError?.(e.error);
  rec.onend = () => handlers.onEnd?.();

  return {
    start: () => {
      try {
        rec.start();
      } catch {
        /* zaten çalışıyorsa start() istisna atar — yut */
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* yut */
      }
    },
  };
}
