"use client";

// WhatsApp-görünümlü sohbet arayüzü (P3-B).
// Backend'e (api/chat, language/) dokunmaz; /api/chat streaming ucunu tüketir.
// - İşletme seçici (4 demo işletmesi)
// - İşletme seçilince otomatik proaktif mesaj (streaming, canlı yazılma)
// - Alt çubuktan soru → mode='qa' (streaming)
// - Aksiyon butonları (buildActionButton verisi) + P4 için simülasyon
// - Sesli giriş (voice.ts) — desteklenmezse mikrofon gizlenir

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { ActionButton } from "@/lib/language/actions";
import { labelForActionType } from "@/lib/language/actions";
import { capabilitiesMessage, detectIntent } from "@/lib/language/intent";
import { sanitizeForDisplay } from "@/lib/language/sanitize";
import {
  createVoiceRecognizer,
  isVoiceSupported,
  type VoiceController,
} from "@/lib/language/voice";

// Sunucudan (page.tsx) gelen demo işletmesi verisi.
export interface DemoMerchant {
  id: string;
  name: string;
  sector: string;
  district: string;
  /** Demo rolü (chip ipucu). */
  note: string;
  /** Bu işyerinin aksiyon butonları (buildActionButtons çıktısı). */
  actions: ActionButton[];
}

interface ChatMessage {
  id: string;
  role: "bot" | "user";
  text: string;
  time: string;
  streaming?: boolean;
  isError?: boolean;
  status?: "sending" | "sent";
  actions?: ActionButton[];
  /** Aksiyon sonucu üretilen tıklanabilir link (ör. ödeme linki). */
  link?: { href: string; label: string };
}

const SECTOR_EMOJI: Record<string, string> = {
  kasap: "🥩",
  kafe: "☕",
  kuafor: "💈",
  eticaret: "🛒",
};

// Aksiyon tipine göre buton emojisi.
const ACTION_EMOJI: Record<string, string> = {
  odeme_linki_olustur: "🔗",
  kampanya_linki_olustur: "🎟️",
  ek_terminal_talep: "🖥️",
  taksit_aktive_et: "💳",
  dovizli_odeme_ac: "💱",
  destek_kaydi_olustur: "🛠️",
  iade_islemi: "↩️",
  islem_raporu: "📊",
  muhasebe_ozeti: "🧾",
};

// Hafif markdown: **kalın** -> <strong>. Satır sonları kabın whitespace-pre-wrap
// stiliyle korunur. WhatsApp gibi temiz görünsün, ham yıldızlar kaybolsun.
// GÜVENLİK AĞI: gösterilmeden önce metin sanitizeForDisplay'den geçer — bozuk
// unicode (�) veya yabancı alfabe sızıntısı ekrana ASLA gelmez.
function renderRich(raw: string): ReactNode[] {
  const text = sanitizeForDisplay(raw);
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<strong key={key++}>{match[1]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const now = () =>
  new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

let idCounter = 0;
const nextId = () => `m${++idCounter}-${Date.now()}`;

// WhatsApp arkaplan deseni (hafif doodle) — açık bej üstüne çok soluk.
const CHAT_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Cg fill='none' stroke='%23c9bfae' stroke-opacity='0.3' stroke-width='1'%3E%3Ccircle cx='32' cy='32' r='2'/%3E%3Cpath d='M12 12l5 5M52 52l-5-5M52 12l-5 5M12 52l5-5'/%3E%3C/g%3E%3C/svg%3E\")";

export default function ChatClient({ merchants }: { merchants: DemoMerchant[] }) {
  const [activeId, setActiveId] = useState<string>(merchants[0]?.id ?? "");
  const [conversations, setConversations] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Aksiyon butonu durumları: "loading" | "done" (anahtar: msgId:actionType)
  const [actionStates, setActionStates] = useState<Record<string, "loading" | "done">>({});
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);

  const startedRef = useRef<Set<string>>(new Set());
  const recRef = useRef<VoiceController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const active = merchants.find((m) => m.id === activeId);
  const messages = conversations[activeId] ?? [];

  // --- Mesaj yardımcıları ---------------------------------------------------
  const addMessage = useCallback((merchantId: string, msg: ChatMessage) => {
    setConversations((prev) => ({
      ...prev,
      [merchantId]: [...(prev[merchantId] ?? []), msg],
    }));
  }, []);

  const patchMessage = useCallback(
    (merchantId: string, msgId: string, patch: (m: ChatMessage) => ChatMessage) => {
      setConversations((prev) => ({
        ...prev,
        [merchantId]: (prev[merchantId] ?? []).map((m) =>
          m.id === msgId ? patch(m) : m,
        ),
      }));
    },
    [],
  );

  // --- /api/chat streaming tüketici ----------------------------------------
  const streamAssistant = useCallback(
    async (
      merchantId: string,
      body: Record<string, unknown>,
      botId: string,
      attachActions?: ActionButton[],
    ) => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          let err = "Yanıt alınamadı.";
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) err = j.error;
          } catch {
            /* json değilse varsayılan mesaj */
          }
          patchMessage(merchantId, botId, (m) => ({
            ...m,
            streaming: false,
            isError: true,
            text: `⚠️ ${err}`,
          }));
          return;
        }

        // KRİTİK: TextDecoder tek örnek + {stream:true}. Ağ, byte akışını rastgele
        // sınırlardan böler; çok-baytlı Türkçe harfler (ı,ğ,ü,ş,ö,ç) iki chunk'a
        // düşebilir. stream:true yarım baytları buffer'da tutar → bölünme bozulmaz.
        // Döngü sonunda decode() (argümansız) ile buffer'da kalan baytlar flush edilir.
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) patchMessage(merchantId, botId, (m) => ({ ...m, text: m.text + chunk }));
        }
        const tail = decoder.decode(); // buffer'da kalan yarım baytları boşalt
        patchMessage(merchantId, botId, (m) => ({
          ...m,
          text: tail ? m.text + tail : m.text,
          streaming: false,
          actions: attachActions && attachActions.length ? attachActions : m.actions,
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "bağlantı hatası";
        patchMessage(merchantId, botId, (m) => ({
          ...m,
          streaming: false,
          isError: true,
          text: m.text || `⚠️ ${msg}`,
        }));
      } finally {
        setBusy(false);
      }
    },
    [patchMessage],
  );

  // İşletme seçilince otomatik proaktif haftalık mesaj.
  const startProactive = useCallback(
    (m: DemoMerchant) => {
      const botId = nextId();
      addMessage(m.id, { id: botId, role: "bot", text: "", time: now(), streaming: true });
      setBusy(true);
      void streamAssistant(m.id, { merchantId: m.id, mode: "proactive" }, botId, m.actions);
    },
    [addMessage, streamAssistant],
  );

  const kick = useCallback(
    (m: DemoMerchant) => {
      if (startedRef.current.has(m.id)) return;
      startedRef.current.add(m.id);
      startProactive(m);
    },
    [startProactive],
  );

  // İlk açılışta ilk işletmeyi başlat.
  useEffect(() => {
    if (merchants[0]) kick(merchants[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sesli giriş desteğini istemcide (hidrasyon sonrası) belirle.
  useEffect(() => {
    setVoiceOn(isVoiceSupported());
  }, []);

  // Yeni mesaj/akış geldiğinde en alta kaydır (streaming sırasında da).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, activeId]);

  const selectMerchant = (m: DemoMerchant) => {
    if (busy || m.id === activeId) return;
    setActiveId(m.id);
    kick(m);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || busy || !active) return;
    setInput("");
    if (listening) {
      recRef.current?.stop();
      setListening(false);
    }
    // O ana kadarki sohbet = geçmiş (yeni mesaj eklenmeden ÖNCE). Model bunu
    // görüp aynı özeti tekrar etmesin, konuşmayı ilerletsin. Streaming/hata/boş
    // ve simülasyon balonları elenir; ham metin (yıldızlı) gönderilir.
    const history = (conversations[active.id] ?? [])
      .filter((m) => !m.streaming && !m.isError && m.text.trim().length > 0)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      }));

    const uid = nextId();
    addMessage(active.id, { id: uid, role: "user", text, time: now(), status: "sending" });
    // WhatsApp hissi: kısa gecikmeyle çift mavi tik.
    window.setTimeout(
      () => patchMessage(active.id, uid, (m) => ({ ...m, status: "sent" })),
      500,
    );

    // KOMUT SETİ: niyet algıla.
    const intent = detectIntent(text);

    // YETENEK KEŞFİ: "ne yapabilirsin / yardım" → deterministik kategorili liste.
    // Uydurma olmasın diye API'ye gitmez; sabit yetenek kataloğundan gösterilir.
    if (intent.info === "yetenekler") {
      addMessage(active.id, {
        id: nextId(),
        role: "bot",
        text: capabilitiesMessage(),
        time: now(),
      });
      return;
    }

    const botId = nextId();
    addMessage(active.id, { id: botId, role: "bot", text: "", time: now(), streaming: true });
    setBusy(true);

    // Çalıştırılabilir aksiyon varsa cevabın altına tek-tuş buton ekle (yalnızca
    // Moka'da somut karşılığı olanlar). Rapor dönemi gibi parametreler taşınır.
    const intentActions: ActionButton[] = intent.action
      ? [
          {
            findingId: `intent-${botId}`,
            label: labelForActionType(intent.action),
            actionType: intent.action,
            mokaProduct: null,
            rationale: "",
            ...(intent.action === "islem_raporu" && intent.reportPeriod
              ? { params: { period: intent.reportPeriod } }
              : {}),
          },
        ]
      : [];

    void streamAssistant(
      active.id,
      { merchantId: active.id, mode: "qa", message: text, history },
      botId,
      intentActions.length ? intentActions : undefined,
    );
  };

  // --- Aksiyon butonu → GERÇEK /api/action (Moka aksiyon katmanı) ----------
  const handleAction = async (msgId: string, action: ActionButton) => {
    const key = `${msgId}:${action.actionType}`;
    if (actionStates[key]) return; // zaten kuruluyor/hazır
    const mid = activeId;
    setActionStates((s) => ({ ...s, [key]: "loading" }));
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: mid, actionType: action.actionType, params: action.params ?? {} }),
      });
      const outcome = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        link?: string;
        error?: string;
      } | null;

      setActionStates((s) => ({ ...s, [key]: "done" }));

      if (!res.ok || !outcome || outcome.ok === false) {
        addMessage(mid, {
          id: nextId(),
          role: "bot",
          time: now(),
          isError: true,
          text: `⚠️ ${outcome?.error || outcome?.message || "İşlem tamamlanamadı."}`,
        });
        return;
      }
      addMessage(mid, {
        id: nextId(),
        role: "bot",
        time: now(),
        text: outcome.message || "İşlem tamamlandı.",
        link: outcome.link
          ? { href: outcome.link, label: "Ödeme sayfasını aç →" }
          : undefined,
      });
    } catch {
      setActionStates((s) => ({ ...s, [key]: "done" }));
      addMessage(mid, {
        id: nextId(),
        role: "bot",
        time: now(),
        isError: true,
        text: "⚠️ Bağlantı hatası.",
      });
    }
  };

  // --- Sesli giriş ----------------------------------------------------------
  const toggleMic = () => {
    if (!voiceOn) return;
    if (!recRef.current) {
      recRef.current = createVoiceRecognizer({
        onPartial: (t) => setInput(t),
        onFinal: (t) => setInput(t),
        onError: () => setListening(false),
        onEnd: () => setListening(false),
      });
    }
    if (!recRef.current) return;
    if (listening) {
      recRef.current.stop();
      setListening(false);
    } else {
      setInput("");
      recRef.current.start();
      setListening(true);
    }
  };

  if (!active) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b0f19] text-white/60">
        Demo işletmesi bulunamadı.
      </div>
    );
  }

  const avatar = active.name.charAt(0).toUpperCase();

  return (
    <main className="flex min-h-[100dvh] flex-col items-center bg-[#0b0f19]">
      <div className="flex h-[100dvh] w-full max-w-[440px] flex-col">
        {/* Demo işletme seçici (WhatsApp çerçevesinin dışında bir demo kontrolü) */}
        <div className="shrink-0 bg-[#111827] px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
              MokaSense · Demo işletmesi
            </span>
            <Link href="/" className="text-[11px] text-moka hover:underline">
              ← veri paneli
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {merchants.map((m) => {
              const on = m.id === activeId;
              return (
                <button
                  key={m.id}
                  type="button"
                  title={m.note}
                  disabled={busy && !on}
                  onClick={() => selectMerchant(m)}
                  className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs transition ${
                    on
                      ? "bg-whatsapp-accent font-medium text-white"
                      : "bg-white/10 text-white/70 hover:bg-white/20"
                  } ${busy && !on ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  <span>{SECTOR_EMOJI[m.sector] ?? "🏬"}</span>
                  <span className="whitespace-nowrap">{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* WhatsApp çerçevesi */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Başlık çubuğu */}
          <header className="flex shrink-0 items-center gap-3 bg-whatsapp-header px-3 py-2 text-white">
            <Link href="/" className="text-xl leading-none opacity-90 hover:opacity-100">
              ‹
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
              {avatar}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight">
                {active.name}
              </div>
              <div className="text-[11px] leading-tight text-white/70">
                {SECTOR_EMOJI[active.sector] ?? ""} {active.district} · çevrimiçi
              </div>
            </div>
          </header>

          {/* Mesaj alanı */}
          <div
            className="ms-scroll flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
            style={{ backgroundColor: "#ECE5DD", backgroundImage: CHAT_BG }}
          >
            {messages.map((m, i) => (
              <Bubble
                key={m.id}
                msg={m}
                first={i === 0 || messages[i - 1]?.role !== m.role}
                actionStates={actionStates}
                onAction={handleAction}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Yazma çubuğu */}
          <div className="flex shrink-0 items-center gap-2 bg-[#F0F0F0] px-2 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder={listening ? "Dinliyorum…" : "Mesaj yaz"}
              className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400"
            />
            {voiceOn && (
              <button
                type="button"
                onClick={toggleMic}
                aria-label="Sesli giriş"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition ${
                  listening ? "ms-mic-live bg-red-500" : "bg-whatsapp-header"
                }`}
              >
                🎤
              </button>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || busy}
              aria-label="Gönder"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-whatsapp-accent text-white transition disabled:opacity-40"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// --- Mesaj balonu ----------------------------------------------------------
function Bubble({
  msg,
  first,
  actionStates,
  onAction,
}: {
  msg: ChatMessage;
  first: boolean;
  actionStates: Record<string, "loading" | "done">;
  onAction: (msgId: string, action: ActionButton) => void;
}) {
  const isUser = msg.role === "user";
  const typing = msg.streaming && msg.text === "";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
          isUser ? "bg-whatsapp-bubble text-gray-800" : "bg-white text-gray-800"
        } ${first ? (isUser ? "rounded-tr-none" : "rounded-tl-none") : ""} ${
          msg.isError ? "border border-red-200 bg-red-50 text-red-700" : ""
        }`}
      >
        {typing ? (
          <div className="flex items-center gap-1 px-1 py-1">
            <Dot delay={0} />
            <Dot delay={0.2} />
            <Dot delay={0.4} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words leading-snug">
            {renderRich(msg.text)}
          </div>
        )}

        {/* Aksiyon butonları (varsa) */}
        {msg.actions && msg.actions.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-black/5 pt-2">
            {msg.actions.map((a) => {
              const key = `${msg.id}:${a.actionType}`;
              const state = actionStates[key];
              const emoji = ACTION_EMOJI[a.actionType] ?? "✅";
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!!state}
                  onClick={() => onAction(msg.id, a)}
                  title={a.rationale}
                  className={`rounded-md px-3 py-1.5 text-left text-xs font-medium transition ${
                    state === "done"
                      ? "bg-emerald-100 text-emerald-700"
                      : state === "loading"
                        ? "bg-gray-100 text-gray-500"
                        : "bg-whatsapp-header/10 text-whatsapp-header hover:bg-whatsapp-header/20"
                  }`}
                >
                  {state === "done"
                    ? `✓ Hazır — ${a.label}`
                    : state === "loading"
                      ? "⏳ Kuruluyor…"
                      : `${emoji} ${a.label}`}
                </button>
              );
            })}
          </div>
        )}

        {/* Aksiyon sonucu tıklanabilir link (ör. ödeme linki) */}
        {msg.link && (
          <a
            href={msg.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block rounded-md bg-whatsapp-header/10 px-3 py-2 text-xs font-medium text-whatsapp-header underline-offset-2 hover:underline"
          >
            🔗 {msg.link.label}
          </a>
        )}

        {!typing && (
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-gray-500">
            <span>{msg.time}</span>
            {isUser && (
              <span className={msg.status === "sent" ? "text-[#53bdeb]" : "text-gray-400"}>
                {msg.status === "sent" ? "✓✓" : "✓"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="ms-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-gray-400"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}
