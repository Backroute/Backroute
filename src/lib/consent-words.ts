import type { Lang } from "./types";

/**
 * The words of a driver's consent to texts and calls (docs/legal/driver-text-consent.md), shared by the app (which
 * shows them) and the server (which records exactly what was shown).
 */

export const CONSENT_VERSION = "2026-10-01";

export type ConsentVia = "app" | "sms" | "whatsapp" | "voice" | "owner";

/** What the owner checks when adding a driver. */
export const OWNER_ATTESTS = (carrier: string) =>
  `This driver has agreed, in writing, to get texts and calls from ${carrier}'s dispatch line, run by Backroute, about their loads and work, including automated texts and calls from an AI dispatcher. I'll keep a copy of that agreement.`;

/** What a driver agrees to in the app, in the language their app is in (the English is the record of what it means). */
export const DRIVER_AGREES: Record<Lang, (carrier: string) => string> = {
  en: (c) => `I agree that ${c} and its dispatch provider, Backroute, may text and call me, including automated texts and calls from an AI dispatcher, about my loads, schedule, pay and safety. Message frequency varies; message and data rates may apply. I can reply STOP at any time to stop texts, and HELP for help.`,
  es: (c) => `Acepto que ${c} y su proveedor de despacho, Backroute, me envíen mensajes y me llamen, incluso mensajes y llamadas automáticas de un despachador con inteligencia artificial, sobre mis cargas, horarios, pago y seguridad. La frecuencia varía; pueden aplicarse tarifas de mensajes y datos. Puedo responder STOP en cualquier momento para dejar de recibir mensajes, y HELP para ayuda.`,
  pa: (c) => `ਮੈਂ ਸਹਿਮਤ ਹਾਂ ਕਿ ${c} ਅਤੇ ਉਸਦਾ ਡਿਸਪੈਚ ਪ੍ਰਦਾਤਾ Backroute ਮੈਨੂੰ ਮੇਰੇ ਲੋਡ, ਸਮਾਂ-ਸਾਰਣੀ, ਤਨਖਾਹ ਅਤੇ ਸੁਰੱਖਿਆ ਬਾਰੇ ਮੈਸੇਜ ਅਤੇ ਕਾਲ ਕਰ ਸਕਦੇ ਹਨ, AI ਡਿਸਪੈਚਰ ਦੇ ਆਟੋਮੈਟਿਕ ਮੈਸੇਜ ਅਤੇ ਕਾਲਾਂ ਸਮੇਤ। ਮੈਸੇਜ ਦੀ ਗਿਣਤੀ ਬਦਲਦੀ ਹੈ; ਮੈਸੇਜ ਅਤੇ ਡਾਟਾ ਦੇ ਖਰਚੇ ਲੱਗ ਸਕਦੇ ਹਨ। ਮੈਸੇਜ ਬੰਦ ਕਰਨ ਲਈ ਕਦੇ ਵੀ STOP ਅਤੇ ਮਦਦ ਲਈ HELP ਲਿਖ ਸਕਦਾ ਹਾਂ।`,
  hi: (c) => `मैं सहमत हूँ कि ${c} और उसका डिस्पैच प्रदाता Backroute मुझे मेरे लोड, शेड्यूल, वेतन और सुरक्षा के बारे में मैसेज और कॉल कर सकते हैं, जिसमें AI डिस्पैचर के ऑटोमैटिक मैसेज और कॉल भी शामिल हैं। मैसेज की संख्या बदलती रहती है; मैसेज और डेटा शुल्क लग सकते हैं। मैसेज बंद करने के लिए कभी भी STOP और मदद के लिए HELP लिख सकता हूँ।`,
  ru: (c) => `Я согласен, что ${c} и его диспетчерский сервис Backroute могут писать и звонить мне, в том числе автоматически от AI-диспетчера, о моих грузах, графике, оплате и безопасности. Частота сообщений разная; может взиматься плата за сообщения и данные. Я могу в любой момент ответить STOP, чтобы остановить сообщения, и HELP для помощи.`,
  uk: (c) => `Я погоджуюся, що ${c} та його диспетчерський сервіс Backroute можуть писати й дзвонити мені, зокрема автоматично від AI-диспетчера, щодо моїх вантажів, графіка, оплати та безпеки. Частота повідомлень різна; може стягуватися плата за повідомлення та дані. Я можу будь-коли відповісти STOP, щоб зупинити повідомлення, і HELP для допомоги.`,
  fr: (c) => `J'accepte que ${c} et son service de répartition, Backroute, m'envoient des textos et m'appellent, y compris des textos et appels automatiques d'un répartiteur IA, au sujet de mes voyages, horaires, paie et sécurité. La fréquence varie; des frais de messagerie et de données peuvent s'appliquer. Je peux répondre STOP à tout moment pour arrêter les textos, et HELP pour de l'aide.`,
};

/** The first text a driver gets, before anything else, when there's no consent on record yet. */
export const FIRST_TEXT: Record<Lang, (carrier: string) => string> = {
  en: (c) => `${c} dispatch: this is your dispatch line, run by Backroute (an AI dispatcher, with people for emergencies). You'll get texts and calls about your loads. Msg frequency varies. Msg & data rates may apply. Reply YES to confirm, HELP for help, STOP to stop texts.`,
  es: (c) => `Despacho de ${c}: esta es tu línea de despacho, de Backroute (un despachador con IA, con personas para emergencias). Recibirás mensajes y llamadas sobre tus cargas. La frecuencia varía. Pueden aplicarse tarifas. Responde YES para confirmar, HELP para ayuda, STOP para no recibir mensajes.`,
  pa: (c) => `${c} ਡਿਸਪੈਚ: ਇਹ ਤੁਹਾਡੀ ਡਿਸਪੈਚ ਲਾਈਨ ਹੈ, Backroute ਵੱਲੋਂ (AI ਡਿਸਪੈਚਰ, ਐਮਰਜੈਂਸੀ ਲਈ ਲੋਕ ਵੀ)। ਤੁਹਾਨੂੰ ਲੋਡਾਂ ਬਾਰੇ ਮੈਸੇਜ ਅਤੇ ਕਾਲਾਂ ਆਉਣਗੀਆਂ। ਖਰਚੇ ਲੱਗ ਸਕਦੇ ਹਨ। ਪੁਸ਼ਟੀ ਲਈ YES, ਮਦਦ ਲਈ HELP, ਬੰਦ ਕਰਨ ਲਈ STOP ਲਿਖੋ।`,
  hi: (c) => `${c} डिस्पैच: यह आपकी डिस्पैच लाइन है, Backroute द्वारा (AI डिस्पैचर, इमरजेंसी के लिए लोग भी)। आपको लोड के बारे में मैसेज और कॉल आएँगे। शुल्क लग सकते हैं। पुष्टि के लिए YES, मदद के लिए HELP, बंद करने के लिए STOP लिखें।`,
  ru: (c) => `Диспетчерская ${c}: это ваша диспетчерская линия от Backroute (AI-диспетчер, люди для экстренных случаев). Вам будут писать и звонить о грузах. Может взиматься плата. Ответьте YES для подтверждения, HELP для помощи, STOP чтобы остановить.`,
  uk: (c) => `Диспетчерська ${c}: це ваша диспетчерська лінія від Backroute (AI-диспетчер, люди для екстрених випадків). Вам писатимуть і дзвонитимуть щодо вантажів. Може стягуватися плата. Відповідайте YES для підтвердження, HELP для допомоги, STOP щоб зупинити.`,
  fr: (c) => `Répartition ${c} : voici ta ligne de répartition, gérée par Backroute (un répartiteur IA, avec des personnes pour les urgences). Tu recevras des textos et appels sur tes voyages. Des frais peuvent s'appliquer. Réponds YES pour confirmer, HELP pour de l'aide, STOP pour arrêter.`,
};

export const THANKS_YES: Record<Lang, string> = {
  en: "Thanks, you're all set. Text here any time about your loads.",
  es: "Gracias, listo. Escribe aquí cuando quieras sobre tus cargas.",
  pa: "ਧੰਨਵਾਦ, ਸਭ ਤਿਆਰ ਹੈ। ਲੋਡਾਂ ਬਾਰੇ ਕਦੇ ਵੀ ਇੱਥੇ ਮੈਸੇਜ ਕਰੋ।",
  hi: "धन्यवाद, सब तैयार है। लोड के बारे में कभी भी यहाँ मैसेज करें।",
  ru: "Спасибо, всё готово. Пишите сюда о грузах в любое время.",
  uk: "Дякую, все готово. Пишіть сюди про вантажі будь-коли.",
  fr: "Merci, c'est réglé. Écris ici quand tu veux pour tes voyages.",
};
