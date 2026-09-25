import type { Lang } from "../types";

/**
 * The few fixed lines the dispatch number says itself, in each driver's language. Everything else is the AI's own
 * words. The greeting says plainly that it's an AI.
 */

export const GREETING: Record<Lang, (first: string, carrier: string) => string> = {
  en: (f, c) => `Hi ${f}, this is the AI dispatcher for ${c}. What do you need?`,
  es: (f, c) => `Hola ${f}, habla el despachador de inteligencia artificial de ${c}. ¿Qué necesitas?`,
  pa: (f, c) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${f}, ਮੈਂ ${c} ਦਾ AI ਡਿਸਪੈਚਰ ਬੋਲ ਰਿਹਾ ਹਾਂ। ਦੱਸੋ ਕੀ ਚਾਹੀਦਾ ਹੈ?`,
  hi: (f, c) => `नमस्ते ${f}, मैं ${c} का AI डिस्पैचर बोल रहा हूँ। बताइए, क्या चाहिए?`,
  ru: (f, c) => `Привет, ${f}, это AI-диспетчер компании ${c}. Чем помочь?`,
  uk: (f, c) => `Привіт, ${f}, це AI-диспетчер компанії ${c}. Чим допомогти?`,
  fr: (f, c) => `Bonjour ${f}, ici le répartiteur IA de ${c}. Qu'est-ce qu'il te faut ?`,
};

export const DIDNT_HEAR: Record<Lang, string> = {
  en: "Sorry, I didn't catch that. Go ahead.",
  es: "Perdón, no te escuché. Dime.",
  pa: "ਮਾਫ਼ ਕਰਨਾ, ਸੁਣਿਆ ਨਹੀਂ। ਫਿਰ ਦੱਸੋ।",
  hi: "माफ़ कीजिए, सुनाई नहीं दिया। फिर से बताइए।",
  ru: "Извини, не расслышал. Повтори, пожалуйста.",
  uk: "Вибач, не почув. Повтори, будь ласка.",
  fr: "Désolé, je n'ai pas compris. Vas-y.",
};

export const GOODBYE: Record<Lang, string> = {
  en: "Call back any time. Bye.",
  es: "Llama cuando quieras. Adiós.",
  pa: "ਜਦੋਂ ਮਰਜ਼ੀ ਫ਼ੋਨ ਕਰ ਲੈਣਾ। ਅਲਵਿਦਾ।",
  hi: "जब चाहें फिर से फ़ोन कीजिए। अलविदा।",
  ru: "Звони в любое время. Пока.",
  uk: "Дзвони будь-коли. Бувай.",
  fr: "Rappelle quand tu veux. Salut.",
};

/** When the AI can't answer (no key, an outage), a person at the office gets it instead, and the driver hears so. */
export const PASSED_ON_CALL: Record<Lang, string> = {
  en: "Sorry, I can't answer that right now. I've passed it to the office, and someone will call you back.",
  es: "Perdón, ahora no puedo responder eso. Ya le pasé el mensaje a la oficina y alguien te va a llamar.",
  pa: "ਮਾਫ਼ ਕਰਨਾ, ਮੈਂ ਹੁਣੇ ਜਵਾਬ ਨਹੀਂ ਦੇ ਸਕਦਾ। ਮੈਂ ਗੱਲ ਦਫ਼ਤਰ ਨੂੰ ਦੱਸ ਦਿੱਤੀ ਹੈ, ਕੋਈ ਤੁਹਾਨੂੰ ਵਾਪਸ ਫ਼ੋਨ ਕਰੇਗਾ।",
  hi: "माफ़ कीजिए, मैं अभी इसका जवाब नहीं दे सकता। मैंने बात ऑफ़िस तक पहुँचा दी है, कोई आपको वापस फ़ोन करेगा।",
  ru: "Извини, сейчас не могу ответить. Я передал это в офис, тебе перезвонят.",
  uk: "Вибач, зараз не можу відповісти. Я передав це в офіс, тобі передзвонять.",
  fr: "Désolé, je ne peux pas répondre à ça maintenant. J'ai transmis au bureau, quelqu'un va te rappeler.",
};

export const PASSED_ON_TEXT: Record<Lang, string> = {
  en: "Got it. I passed this to the office, and someone will get back to you soon.",
  es: "Entendido. Se lo pasé a la oficina y alguien te va a responder pronto.",
  pa: "ਠੀਕ ਹੈ। ਮੈਂ ਇਹ ਦਫ਼ਤਰ ਨੂੰ ਦੱਸ ਦਿੱਤਾ ਹੈ, ਕੋਈ ਜਲਦੀ ਜਵਾਬ ਦੇਵੇਗਾ।",
  hi: "ठीक है। मैंने यह ऑफ़िस तक पहुँचा दिया है, कोई जल्दी जवाब देगा।",
  ru: "Понял. Передал в офис, тебе скоро ответят.",
  uk: "Зрозумів. Передав в офіс, тобі скоро дадуть відповідь.",
  fr: "Bien reçu. J'ai transmis au bureau, quelqu'un va te répondre bientôt.",
};

/** For a number that isn't any carrier's driver. English and Spanish, since the language isn't known. */
export const UNKNOWN_NUMBER =
  "This is Backroute's AI dispatch line. We don't have this number on file: ask your carrier to add it in Backroute. / Esta es la línea de despacho de Backroute. No tenemos este número: pide a tu transportista que lo agregue.";

export const SMS_HELP = (carrier: string) =>
  `Backroute AI dispatcher for ${carrier}. Text here about your loads. Reply STOP to stop texts. In an emergency call 911.`;

/** The dispatch text a driver gets when a load is added for their truck. */
export const NEW_LOAD: Record<Lang, (p: { ref: string; from: string; to: string; pickup: string; delivery: string }) => string> = {
  en: (p) => `New load ${p.ref}: ${p.from} → ${p.to}. Pickup ${p.pickup}. Delivery ${p.delivery}. Details in the Backroute app. Text back here with any questions.`,
  es: (p) => `Nueva carga ${p.ref}: ${p.from} → ${p.to}. Recogida ${p.pickup}. Entrega ${p.delivery}. Detalles en la app de Backroute. Responde aquí si tienes preguntas.`,
  pa: (p) => `ਨਵਾਂ ਲੋਡ ${p.ref}: ${p.from} → ${p.to}। ਪਿਕਅੱਪ ${p.pickup}। ਡਿਲੀਵਰੀ ${p.delivery}। ਪੂਰੀ ਜਾਣਕਾਰੀ Backroute ਐਪ ਵਿੱਚ। ਕੋਈ ਸਵਾਲ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਮੈਸੇਜ ਕਰੋ।`,
  hi: (p) => `नया लोड ${p.ref}: ${p.from} → ${p.to}। पिकअप ${p.pickup}। डिलीवरी ${p.delivery}। पूरी जानकारी Backroute ऐप में। कोई सवाल हो तो यहीं मैसेज करें।`,
  ru: (p) => `Новый груз ${p.ref}: ${p.from} → ${p.to}. Загрузка ${p.pickup}. Выгрузка ${p.delivery}. Подробности в приложении Backroute. Вопросы пиши сюда.`,
  uk: (p) => `Новий вантаж ${p.ref}: ${p.from} → ${p.to}. Завантаження ${p.pickup}. Розвантаження ${p.delivery}. Деталі в застосунку Backroute. Питання пиши сюди.`,
  fr: (p) => `Nouveau voyage ${p.ref} : ${p.from} → ${p.to}. Chargement ${p.pickup}. Livraison ${p.delivery}. Détails dans l'appli Backroute. Réponds ici si tu as des questions.`,
};
