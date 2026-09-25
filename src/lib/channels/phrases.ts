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

type Stop = { ref: string; place: string; time: string };

/**
 * The check-ins the AI sends drivers on its own, like a dispatcher watching the board: before each appointment, when
 * one is missed, and for the POD. The driver answers by text or on a call, and the AI takes it from there.
 */
export const CHECKIN: Record<"before_pickup" | "pickup_late" | "before_delivery" | "delivery_late" | "pod_needed", Record<Lang, (p: Stop) => string>> = {
  before_pickup: {
    en: (p) => `Load ${p.ref}: pickup at ${p.place} is ${p.time}. On track? Reply here if anything's off.`,
    es: (p) => `Carga ${p.ref}: la recogida en ${p.place} es ${p.time}. ¿Vas a tiempo? Responde aquí si hay algún problema.`,
    pa: (p) => `ਲੋਡ ${p.ref}: ${p.place} ਵਿੱਚ ਪਿਕਅੱਪ ${p.time} ਹੈ। ਸਮੇਂ ਸਿਰ ਹੋ? ਕੋਈ ਗੱਲ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਦੱਸੋ।`,
    hi: (p) => `लोड ${p.ref}: ${p.place} में पिकअप ${p.time} है। समय पर हैं? कोई दिक्कत हो तो यहीं बताइए।`,
    ru: (p) => `Груз ${p.ref}: загрузка в ${p.place} — ${p.time}. Успеваешь? Если что-то не так, напиши сюда.`,
    uk: (p) => `Вантаж ${p.ref}: завантаження в ${p.place} — ${p.time}. Встигаєш? Якщо щось не так, напиши сюди.`,
    fr: (p) => `Voyage ${p.ref} : chargement à ${p.place} ${p.time}. Tu es dans les temps ? Réponds ici s'il y a un souci.`,
  },
  pickup_late: {
    en: (p) => `Load ${p.ref}: pickup at ${p.place} was ${p.time}. Are you there? Reply with where you are.`,
    es: (p) => `Carga ${p.ref}: la recogida en ${p.place} era ${p.time}. ¿Ya llegaste? Responde con dónde estás.`,
    pa: (p) => `ਲੋਡ ${p.ref}: ${p.place} ਵਿੱਚ ਪਿਕਅੱਪ ${p.time} ਸੀ। ਪਹੁੰਚ ਗਏ? ਦੱਸੋ ਕਿੱਥੇ ਹੋ।`,
    hi: (p) => `लोड ${p.ref}: ${p.place} में पिकअप ${p.time} था। पहुँच गए? बताइए आप कहाँ हैं।`,
    ru: (p) => `Груз ${p.ref}: загрузка в ${p.place} была ${p.time}. Ты на месте? Напиши, где ты.`,
    uk: (p) => `Вантаж ${p.ref}: завантаження в ${p.place} було ${p.time}. Ти на місці? Напиши, де ти.`,
    fr: (p) => `Voyage ${p.ref} : le chargement à ${p.place} était ${p.time}. Tu es arrivé ? Dis-moi où tu es.`,
  },
  before_delivery: {
    en: (p) => `Load ${p.ref}: delivery in ${p.place} is ${p.time}. On track? Reply here if you'll be late.`,
    es: (p) => `Carga ${p.ref}: la entrega en ${p.place} es ${p.time}. ¿Vas a tiempo? Avisa aquí si vas a llegar tarde.`,
    pa: (p) => `ਲੋਡ ${p.ref}: ${p.place} ਵਿੱਚ ਡਿਲੀਵਰੀ ${p.time} ਹੈ। ਸਮੇਂ ਸਿਰ ਹੋ? ਦੇਰ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਦੱਸੋ।`,
    hi: (p) => `लोड ${p.ref}: ${p.place} में डिलीवरी ${p.time} है। समय पर हैं? देर हो तो यहीं बताइए।`,
    ru: (p) => `Груз ${p.ref}: выгрузка в ${p.place} — ${p.time}. Успеваешь? Если опаздываешь, напиши сюда.`,
    uk: (p) => `Вантаж ${p.ref}: розвантаження в ${p.place} — ${p.time}. Встигаєш? Якщо запізнюєшся, напиши сюди.`,
    fr: (p) => `Voyage ${p.ref} : livraison à ${p.place} ${p.time}. Tu es dans les temps ? Préviens ici si tu seras en retard.`,
  },
  delivery_late: {
    en: (p) => `Load ${p.ref}: delivery in ${p.place} was ${p.time}. Are you there? Reply with where you are.`,
    es: (p) => `Carga ${p.ref}: la entrega en ${p.place} era ${p.time}. ¿Ya llegaste? Responde con dónde estás.`,
    pa: (p) => `ਲੋਡ ${p.ref}: ${p.place} ਵਿੱਚ ਡਿਲੀਵਰੀ ${p.time} ਸੀ। ਪਹੁੰਚ ਗਏ? ਦੱਸੋ ਕਿੱਥੇ ਹੋ।`,
    hi: (p) => `लोड ${p.ref}: ${p.place} में डिलीवरी ${p.time} थी। पहुँच गए? बताइए आप कहाँ हैं।`,
    ru: (p) => `Груз ${p.ref}: выгрузка в ${p.place} была ${p.time}. Ты на месте? Напиши, где ты.`,
    uk: (p) => `Вантаж ${p.ref}: розвантаження в ${p.place} було ${p.time}. Ти на місці? Напиши, де ти.`,
    fr: (p) => `Voyage ${p.ref} : la livraison à ${p.place} était ${p.time}. Tu es arrivé ? Dis-moi où tu es.`,
  },
  pod_needed: {
    en: (p) => `Load ${p.ref}: once you're unloaded, take a photo of the signed POD in the Backroute app. Tell me here about any shortage or damage.`,
    es: (p) => `Carga ${p.ref}: cuando te descarguen, toma una foto del POD firmado en la app de Backroute. Avísame aquí si hay faltantes o daños.`,
    pa: (p) => `ਲੋਡ ${p.ref}: ਅਨਲੋਡ ਹੋਣ ਤੋਂ ਬਾਅਦ, Backroute ਐਪ ਵਿੱਚ ਦਸਤਖ਼ਤ ਵਾਲੇ POD ਦੀ ਫ਼ੋਟੋ ਲਓ। ਕੋਈ ਘਾਟ ਜਾਂ ਨੁਕਸਾਨ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਦੱਸੋ।`,
    hi: (p) => `लोड ${p.ref}: अनलोड होने के बाद, Backroute ऐप में साइन किए हुए POD की फ़ोटो लीजिए। कोई कमी या नुकसान हो तो यहीं बताइए।`,
    ru: (p) => `Груз ${p.ref}: после выгрузки сфотографируй подписанный POD в приложении Backroute. Если есть недостача или повреждения, напиши сюда.`,
    uk: (p) => `Вантаж ${p.ref}: після розвантаження сфотографуй підписаний POD у застосунку Backroute. Якщо є нестача чи пошкодження, напиши сюди.`,
    fr: (p) => `Voyage ${p.ref} : une fois déchargé, prends en photo le POD signé dans l'appli Backroute. Dis-moi ici s'il y a un manque ou des dommages.`,
  },
};

/** How a check-in call opens, before the question. It says it's an AI. */
export const CHECKIN_CALL: Record<Lang, (first: string, carrier: string) => string> = {
  en: (f, c) => `Hi ${f}, this is the AI dispatcher for ${c}, checking on your load.`,
  es: (f, c) => `Hola ${f}, habla el despachador de inteligencia artificial de ${c}, para preguntar por tu carga.`,
  pa: (f, c) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${f}, ਮੈਂ ${c} ਦਾ AI ਡਿਸਪੈਚਰ ਹਾਂ, ਤੁਹਾਡੇ ਲੋਡ ਬਾਰੇ ਪੁੱਛਣ ਲਈ ਫ਼ੋਨ ਕੀਤਾ ਹੈ।`,
  hi: (f, c) => `नमस्ते ${f}, मैं ${c} का AI डिस्पैचर हूँ, आपके लोड के बारे में पूछने के लिए फ़ोन किया है।`,
  ru: (f, c) => `Привет, ${f}, это AI-диспетчер компании ${c}, звоню узнать про твой груз.`,
  uk: (f, c) => `Привіт, ${f}, це AI-диспетчер компанії ${c}, дзвоню дізнатися про твій вантаж.`,
  fr: (f, c) => `Bonjour ${f}, ici le répartiteur IA de ${c}, j'appelle pour ton voyage.`,
};

/** To the owner, when a driver doesn't answer a check-in. The details are on the Needs you list. */
export const DRIVER_SILENT: Record<Lang, (driver: string, ref: string) => string> = {
  en: (d, r) => `Backroute: ${d} hasn't answered about load ${r}. It's in Needs you.`,
  es: (d, r) => `Backroute: ${d} no ha respondido sobre la carga ${r}. Está en «Te necesita».`,
  pa: (d, r) => `Backroute: ${d} ਨੇ ਲੋਡ ${r} ਬਾਰੇ ਜਵਾਬ ਨਹੀਂ ਦਿੱਤਾ। ਇਹ "ਤੁਹਾਡੀ ਲੋੜ ਹੈ" ਸੂਚੀ ਵਿੱਚ ਹੈ।`,
  hi: (d, r) => `Backroute: ${d} ने लोड ${r} के बारे में जवाब नहीं दिया। यह "आपकी ज़रूरत है" सूची में है।`,
  ru: (d, r) => `Backroute: ${d} не отвечает по грузу ${r}. Это в разделе «Нужно твоё решение».`,
  uk: (d, r) => `Backroute: ${d} не відповідає щодо вантажу ${r}. Це в розділі «Потрібне твоє рішення».`,
  fr: (d, r) => `Backroute : ${d} n'a pas répondu pour le voyage ${r}. C'est dans « Ça t'attend ».`,
};

/** The broker cancelled a load the driver was on or about to take. */
export const LOAD_CANCELLED: Record<Lang, (ref: string, place: string) => string> = {
  en: (r, p) => `Load ${r} to ${p} was cancelled by the broker. Don't go to the pickup. I'm finding your next load and will text you.`,
  es: (r, p) => `El bróker canceló la carga ${r} a ${p}. No vayas a la recogida. Estoy buscando tu próxima carga y te aviso por mensaje.`,
  pa: (r, p) => `ਬ੍ਰੋਕਰ ਨੇ ${p} ਵਾਲਾ ਲੋਡ ${r} ਰੱਦ ਕਰ ਦਿੱਤਾ ਹੈ। ਪਿਕਅੱਪ 'ਤੇ ਨਾ ਜਾਣਾ। ਮੈਂ ਤੁਹਾਡਾ ਅਗਲਾ ਲੋਡ ਲੱਭ ਰਿਹਾ ਹਾਂ, ਮੈਸੇਜ ਕਰਾਂਗਾ।`,
  hi: (r, p) => `ब्रोकर ने ${p} वाला लोड ${r} रद्द कर दिया है। पिकअप पर मत जाइए। मैं आपका अगला लोड ढूँढ रहा हूँ, मैसेज करूँगा।`,
  ru: (r, p) => `Брокер отменил груз ${r} в ${p}. На загрузку не езжай. Ищу тебе следующий груз, напишу.`,
  uk: (r, p) => `Брокер скасував вантаж ${r} до ${p}. На завантаження не їдь. Шукаю тобі наступний вантаж, напишу.`,
  fr: (r, p) => `Le courtier a annulé le voyage ${r} vers ${p}. Ne va pas au chargement. Je te cherche le prochain voyage et je t'écris.`,
};

/** Breakdown: the repair shops the AI found near the truck, and what the one it called said. */
export const SHOPS_NEAR: Record<Lang, (p: { list: string; calling: string | null }) => string> = {
  en: (p) => `Repair help near you:\n${p.list}\n${p.calling ? `I'm calling ${p.calling} now and will text you what they say.` : "Call the first one that's open."} Stay safe: flashers on, triangles out.`,
  es: (p) => `Talleres cerca de ti:\n${p.list}\n${p.calling ? `Estoy llamando a ${p.calling} ahora y te escribo lo que digan.` : "Llama al primero que esté abierto."} Cuídate: intermitentes y triángulos.`,
  pa: (p) => `ਤੁਹਾਡੇ ਨੇੜੇ ਰਿਪੇਅਰ:\n${p.list}\n${p.calling ? `ਮੈਂ ਹੁਣੇ ${p.calling} ਨੂੰ ਫ਼ੋਨ ਕਰ ਰਿਹਾ ਹਾਂ, ਉਹ ਕੀ ਕਹਿੰਦੇ ਹਨ ਮੈਸੇਜ ਕਰਾਂਗਾ।` : "ਜੋ ਪਹਿਲਾ ਖੁੱਲ੍ਹਾ ਹੈ ਉਸ ਨੂੰ ਫ਼ੋਨ ਕਰੋ।"} ਧਿਆਨ ਰੱਖੋ: ਫਲੈਸ਼ਰ ਚਾਲੂ, ਤਿਕੋਣ ਬਾਹਰ।`,
  hi: (p) => `आपके पास रिपेयर:\n${p.list}\n${p.calling ? `मैं अभी ${p.calling} को फ़ोन कर रहा हूँ, वे जो कहें मैसेज करूँगा।` : "जो पहला खुला हो उसे फ़ोन करें।"} सुरक्षित रहें: फ्लैशर चालू, त्रिकोण बाहर।`,
  ru: (p) => `Ремонт рядом с тобой:\n${p.list}\n${p.calling ? `Звоню в ${p.calling}, напишу, что скажут.` : "Звони в первый, что открыт."} Аварийка и знаки.`,
  uk: (p) => `Ремонт поруч із тобою:\n${p.list}\n${p.calling ? `Дзвоню в ${p.calling}, напишу, що скажуть.` : "Дзвони в перший, що відкритий."} Аварійка і знаки.`,
  fr: (p) => `Réparation près de toi :\n${p.list}\n${p.calling ? `J'appelle ${p.calling} maintenant et je t'écris ce qu'ils disent.` : "Appelle le premier qui est ouvert."} Prudence : feux de détresse et triangles.`,
};

export const SHOP_CAN_HELP: Record<Lang, (p: { shop: string; phone: string; eta: string | null }) => string> = {
  en: (p) => `${p.shop} can help${p.eta ? ` (${p.eta})` : ""}. Call them to set it up: ${p.phone}. The owner knows.`,
  es: (p) => `${p.shop} puede ayudar${p.eta ? ` (${p.eta})` : ""}. Llámalos para arreglarlo: ${p.phone}. El dueño ya sabe.`,
  pa: (p) => `${p.shop} ਮਦਦ ਕਰ ਸਕਦੇ ਹਨ${p.eta ? ` (${p.eta})` : ""}। ਗੱਲ ਪੱਕੀ ਕਰਨ ਲਈ ਫ਼ੋਨ ਕਰੋ: ${p.phone}। ਮਾਲਕ ਨੂੰ ਪਤਾ ਹੈ।`,
  hi: (p) => `${p.shop} मदद कर सकते हैं${p.eta ? ` (${p.eta})` : ""}। तय करने के लिए फ़ोन करें: ${p.phone}। मालिक को पता है।`,
  ru: (p) => `${p.shop} могут помочь${p.eta ? ` (${p.eta})` : ""}. Позвони им договориться: ${p.phone}. Владелец в курсе.`,
  uk: (p) => `${p.shop} можуть допомогти${p.eta ? ` (${p.eta})` : ""}. Подзвони їм домовитися: ${p.phone}. Власник у курсі.`,
  fr: (p) => `${p.shop} peut t'aider${p.eta ? ` (${p.eta})` : ""}. Appelle-les pour organiser : ${p.phone}. Le propriétaire est au courant.`,
};

/** The weekly check-in the AI sends each driver, the way a good dispatcher calls to ask how it's going. */
export const WEEKLY_CHECKIN: Record<Lang, (first: string, carrier: string) => string> = {
  en: (f, c) => `Hi ${f}, it's the AI dispatcher for ${c}. Quick weekly check-in: how's it going out there? Anything about loads, pay, home time or the truck you'd like changed? Just reply here.`,
  es: (f, c) => `Hola ${f}, habla el despachador IA de ${c}. Chequeo semanal rápido: ¿cómo va todo? ¿Algo de cargas, pago, tiempo en casa o el camión que quieras cambiar? Responde aquí.`,
  pa: (f, c) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${f}, ਮੈਂ ${c} ਦਾ AI ਡਿਸਪੈਚਰ ਹਾਂ। ਹਫ਼ਤਾਵਾਰੀ ਹਾਲ-ਚਾਲ: ਸਭ ਠੀਕ ਚੱਲ ਰਿਹਾ ਹੈ? ਲੋਡ, ਤਨਖ਼ਾਹ, ਘਰ ਦਾ ਸਮਾਂ ਜਾਂ ਟਰੱਕ ਬਾਰੇ ਕੁਝ ਬਦਲਣਾ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਦੱਸੋ।`,
  hi: (f, c) => `नमस्ते ${f}, मैं ${c} का AI डिस्पैचर हूँ। हफ़्ते का हाल-चाल: सब ठीक चल रहा है? लोड, पेमेंट, घर का समय या ट्रक के बारे में कुछ बदलना हो तो यहीं बताइए।`,
  ru: (f, c) => `Привет, ${f}, это AI-диспетчер ${c}. Еженедельный вопрос: как дела в дороге? Что-то по грузам, оплате, времени дома или траку хочешь поменять? Просто ответь сюда.`,
  uk: (f, c) => `Привіт, ${f}, це AI-диспетчер ${c}. Щотижневе питання: як справи в дорозі? Щось щодо вантажів, оплати, часу вдома чи трака хочеш змінити? Просто відповідай сюди.`,
  fr: (f, c) => `Salut ${f}, ici le répartiteur IA de ${c}. Petit point de la semaine : comment ça va sur la route ? Quelque chose à changer côté voyages, paie, temps à la maison ou camion ? Réponds ici.`,
};

/** The weekly pay summary, when the owner turned it on. Before deductions: the owner's payroll has the final number. */
export const WEEKLY_PAY: Record<Lang, (p: { loads: number; miles: string; pay: string; from: string; to: string }) => string> = {
  en: (p) => `Your week (${p.from} to ${p.to}): ${p.loads} load${p.loads === 1 ? "" : "s"}, ${p.miles} miles, about ${p.pay} in pay before deductions. Questions about it? Reply here.`,
  es: (p) => `Tu semana (${p.from} a ${p.to}): ${p.loads} carga${p.loads === 1 ? "" : "s"}, ${p.miles} millas, unos ${p.pay} de pago antes de deducciones. ¿Preguntas? Responde aquí.`,
  pa: (p) => `ਤੁਹਾਡਾ ਹਫ਼ਤਾ (${p.from} ਤੋਂ ${p.to}): ${p.loads} ਲੋਡ, ${p.miles} ਮੀਲ, ਕਟੌਤੀਆਂ ਤੋਂ ਪਹਿਲਾਂ ਲਗਭਗ ${p.pay}। ਕੋਈ ਸਵਾਲ? ਇੱਥੇ ਦੱਸੋ।`,
  hi: (p) => `आपका हफ़्ता (${p.from} से ${p.to}): ${p.loads} लोड, ${p.miles} मील, कटौती से पहले लगभग ${p.pay}। कोई सवाल? यहीं बताइए।`,
  ru: (p) => `Твоя неделя (${p.from}–${p.to}): грузов ${p.loads}, ${p.miles} миль, около ${p.pay} до вычетов. Вопросы? Пиши сюда.`,
  uk: (p) => `Твій тиждень (${p.from}–${p.to}): вантажів ${p.loads}, ${p.miles} миль, близько ${p.pay} до відрахувань. Питання? Пиши сюди.`,
  fr: (p) => `Ta semaine (du ${p.from} au ${p.to}) : ${p.loads} voyage${p.loads === 1 ? "" : "s"}, ${p.miles} milles, environ ${p.pay} de paie avant retenues. Des questions ? Réponds ici.`,
};
