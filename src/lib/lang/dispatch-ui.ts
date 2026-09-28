import type { AlertWords } from "@/components/cloud/phone-alerts";
import type { Lang } from "../types";

/** The driver app's words for how dispatch reaches them: notifications, SMS or WhatsApp, the morning text, consent. */
export interface DispatchUi {
  title: string;
  alerts: AlertWords;
  textsBy: string;
  sms: string;
  whatsapp: string;
  openWhatsApp: string;
  morning: string;
  morningNote: string;
  voice: string;
  voiceNote: string;
  consentTitle: string;
  consentAsk: string;
  agree: string;
  decline: string;
  agreed(date: string): string;
  declined: string;
  saving: string;
  failed: string;
}

const en: DispatchUi = {
  title: "How dispatch reaches you",
  alerts: {
    title: "Notifications",
    unsupported: "This phone can't show notifications from a web page. On an iPhone, add Backroute to your home screen (Share → Add to Home Screen) and open it from there.",
    off: "See messages from dispatch on your lock screen, the moment they come in.",
    on: "On for this phone. Texts still come too, so you never miss one.",
    blocked: "Notifications are blocked for Backroute in your phone's settings. Allow them there, then come back.",
    turnOn: "Turn on",
    turnOff: "Turn off",
    failed: "Couldn't turn them on. Try again.",
  },
  textsBy: "Texts come by",
  sms: "Text message",
  whatsapp: "WhatsApp",
  openWhatsApp: "Message dispatch on WhatsApp",
  morning: "Morning text",
  morningNote: "Your stops, times, dock tips and weather, before you roll.",
  voice: "Voice answers",
  voiceNote: "Send a voice message on WhatsApp and the answer comes back spoken too.",
  consentTitle: "Texts and calls from dispatch",
  consentAsk: "Dispatch needs your OK to text and call you about your loads.",
  agree: "I agree",
  decline: "Not now",
  agreed: (d) => `You agreed on ${d}. Text STOP any time to stop.`,
  declined: "You said not now. Dispatch won't text you until you agree.",
  saving: "Saving…",
  failed: "Couldn't save. Try again.",
};

const es: DispatchUi = {
  title: "Cómo te contacta el despacho",
  alerts: {
    title: "Notificaciones",
    unsupported: "Este teléfono no puede mostrar notificaciones de una página web. En iPhone, agrega Backroute a tu pantalla de inicio (Compartir → Agregar a inicio) y ábrelo desde ahí.",
    off: "Ve los mensajes del despacho en tu pantalla de bloqueo en cuanto lleguen.",
    on: "Activadas en este teléfono. Los mensajes de texto también llegan, para que no te pierdas nada.",
    blocked: "Las notificaciones de Backroute están bloqueadas en los ajustes del teléfono. Permítelas ahí y vuelve.",
    turnOn: "Activar",
    turnOff: "Desactivar",
    failed: "No se pudieron activar. Inténtalo otra vez.",
  },
  textsBy: "Los mensajes llegan por",
  sms: "Mensaje de texto",
  whatsapp: "WhatsApp",
  openWhatsApp: "Escribir al despacho por WhatsApp",
  morning: "Mensaje de la mañana",
  morningNote: "Tus paradas, horarios, consejos del muelle y el clima, antes de salir.",
  voice: "Respuestas de voz",
  voiceNote: "Manda un mensaje de voz por WhatsApp y la respuesta también llega en voz.",
  consentTitle: "Mensajes y llamadas del despacho",
  consentAsk: "El despacho necesita tu permiso para enviarte mensajes y llamarte sobre tus cargas.",
  agree: "Acepto",
  decline: "Ahora no",
  agreed: (d) => `Aceptaste el ${d}. Escribe STOP cuando quieras para dejar de recibirlos.`,
  declined: "Dijiste que ahora no. El despacho no te enviará mensajes hasta que aceptes.",
  saving: "Guardando…",
  failed: "No se pudo guardar. Inténtalo otra vez.",
};

const pa: DispatchUi = {
  title: "ਡਿਸਪੈਚ ਤੁਹਾਡੇ ਨਾਲ ਕਿਵੇਂ ਸੰਪਰਕ ਕਰੇ",
  alerts: {
    title: "ਨੋਟੀਫਿਕੇਸ਼ਨ",
    unsupported: "ਇਹ ਫ਼ੋਨ ਵੈੱਬ ਪੇਜ ਦੇ ਨੋਟੀਫਿਕੇਸ਼ਨ ਨਹੀਂ ਦਿਖਾ ਸਕਦਾ। iPhone 'ਤੇ Backroute ਨੂੰ ਹੋਮ ਸਕ੍ਰੀਨ 'ਤੇ ਜੋੜੋ (Share → Add to Home Screen) ਅਤੇ ਉੱਥੋਂ ਖੋਲ੍ਹੋ।",
    off: "ਡਿਸਪੈਚ ਦੇ ਮੈਸੇਜ ਆਉਂਦੇ ਹੀ ਲਾਕ ਸਕ੍ਰੀਨ 'ਤੇ ਦੇਖੋ।",
    on: "ਇਸ ਫ਼ੋਨ 'ਤੇ ਚਾਲੂ। ਮੈਸੇਜ ਵੀ ਆਉਂਦੇ ਰਹਿਣਗੇ, ਤਾਂ ਜੋ ਕੁਝ ਨਾ ਛੁੱਟੇ।",
    blocked: "ਫ਼ੋਨ ਦੀਆਂ ਸੈਟਿੰਗਾਂ ਵਿੱਚ Backroute ਦੇ ਨੋਟੀਫਿਕੇਸ਼ਨ ਬੰਦ ਹਨ। ਉੱਥੇ ਚਾਲੂ ਕਰੋ, ਫਿਰ ਵਾਪਸ ਆਓ।",
    turnOn: "ਚਾਲੂ ਕਰੋ",
    turnOff: "ਬੰਦ ਕਰੋ",
    failed: "ਚਾਲੂ ਨਹੀਂ ਹੋਏ। ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  textsBy: "ਮੈਸੇਜ ਕਿਸ ਰਾਹੀਂ",
  sms: "ਟੈਕਸਟ ਮੈਸੇਜ",
  whatsapp: "WhatsApp",
  openWhatsApp: "WhatsApp 'ਤੇ ਡਿਸਪੈਚ ਨੂੰ ਮੈਸੇਜ ਕਰੋ",
  morning: "ਸਵੇਰ ਦਾ ਮੈਸੇਜ",
  morningNote: "ਤੁਹਾਡੇ ਸਟਾਪ, ਸਮਾਂ, ਡੌਕ ਦੀਆਂ ਗੱਲਾਂ ਅਤੇ ਮੌਸਮ, ਚੱਲਣ ਤੋਂ ਪਹਿਲਾਂ।",
  voice: "ਆਵਾਜ਼ ਵਿੱਚ ਜਵਾਬ",
  voiceNote: "WhatsApp 'ਤੇ ਵੌਇਸ ਮੈਸੇਜ ਭੇਜੋ, ਜਵਾਬ ਵੀ ਆਵਾਜ਼ ਵਿੱਚ ਆਵੇਗਾ।",
  consentTitle: "ਡਿਸਪੈਚ ਦੇ ਮੈਸੇਜ ਅਤੇ ਕਾਲਾਂ",
  consentAsk: "ਲੋਡਾਂ ਬਾਰੇ ਮੈਸੇਜ ਅਤੇ ਕਾਲ ਕਰਨ ਲਈ ਡਿਸਪੈਚ ਨੂੰ ਤੁਹਾਡੀ ਹਾਂ ਚਾਹੀਦੀ ਹੈ।",
  agree: "ਮੈਂ ਸਹਿਮਤ ਹਾਂ",
  decline: "ਹੁਣ ਨਹੀਂ",
  agreed: (d) => `ਤੁਸੀਂ ${d} ਨੂੰ ਸਹਿਮਤੀ ਦਿੱਤੀ। ਬੰਦ ਕਰਨ ਲਈ ਕਦੇ ਵੀ STOP ਲਿਖੋ।`,
  declined: "ਤੁਸੀਂ ਹੁਣ ਨਹੀਂ ਕਿਹਾ। ਸਹਿਮਤੀ ਤੱਕ ਡਿਸਪੈਚ ਮੈਸੇਜ ਨਹੀਂ ਕਰੇਗਾ।",
  saving: "ਸੇਵ ਹੋ ਰਿਹਾ ਹੈ…",
  failed: "ਸੇਵ ਨਹੀਂ ਹੋਇਆ। ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
};

const hi: DispatchUi = {
  title: "डिस्पैच आपसे कैसे संपर्क करे",
  alerts: {
    title: "नोटिफ़िकेशन",
    unsupported: "यह फ़ोन वेब पेज के नोटिफ़िकेशन नहीं दिखा सकता। iPhone पर Backroute को होम स्क्रीन पर जोड़ें (Share → Add to Home Screen) और वहीं से खोलें।",
    off: "डिस्पैच के मैसेज आते ही लॉक स्क्रीन पर देखें।",
    on: "इस फ़ोन पर चालू। मैसेज भी आते रहेंगे, ताकि कुछ न छूटे।",
    blocked: "फ़ोन की सेटिंग्स में Backroute के नोटिफ़िकेशन बंद हैं। वहाँ चालू करें, फिर वापस आएँ।",
    turnOn: "चालू करें",
    turnOff: "बंद करें",
    failed: "चालू नहीं हुए। फिर से कोशिश करें।",
  },
  textsBy: "मैसेज किससे आएँ",
  sms: "टेक्स्ट मैसेज",
  whatsapp: "WhatsApp",
  openWhatsApp: "WhatsApp पर डिस्पैच को मैसेज करें",
  morning: "सुबह का मैसेज",
  morningNote: "आपके स्टॉप, समय, डॉक की जानकारी और मौसम, निकलने से पहले।",
  voice: "आवाज़ में जवाब",
  voiceNote: "WhatsApp पर वॉइस मैसेज भेजें, जवाब भी आवाज़ में आएगा।",
  consentTitle: "डिस्पैच के मैसेज और कॉल",
  consentAsk: "लोड के बारे में मैसेज और कॉल करने के लिए डिस्पैच को आपकी हाँ चाहिए।",
  agree: "मैं सहमत हूँ",
  decline: "अभी नहीं",
  agreed: (d) => `आपने ${d} को सहमति दी। बंद करने के लिए कभी भी STOP लिखें।`,
  declined: "आपने अभी नहीं कहा। सहमति तक डिस्पैच मैसेज नहीं करेगा।",
  saving: "सेव हो रहा है…",
  failed: "सेव नहीं हुआ। फिर से कोशिश करें।",
};

const ru: DispatchUi = {
  title: "Как с вами связывается диспетчер",
  alerts: {
    title: "Уведомления",
    unsupported: "Этот телефон не показывает уведомления с веб-страницы. На iPhone добавьте Backroute на экран «Домой» (Поделиться → На экран «Домой») и открывайте оттуда.",
    off: "Сообщения от диспетчера на экране блокировки, сразу как придут.",
    on: "Включены на этом телефоне. SMS тоже приходят, чтобы ничего не пропустить.",
    blocked: "Уведомления Backroute запрещены в настройках телефона. Разрешите их там и вернитесь.",
    turnOn: "Включить",
    turnOff: "Выключить",
    failed: "Не удалось включить. Попробуйте ещё раз.",
  },
  textsBy: "Сообщения приходят через",
  sms: "SMS",
  whatsapp: "WhatsApp",
  openWhatsApp: "Написать диспетчеру в WhatsApp",
  morning: "Утреннее сообщение",
  morningNote: "Ваши остановки, время, советы по докам и погода, до выезда.",
  voice: "Голосовые ответы",
  voiceNote: "Отправьте голосовое в WhatsApp, и ответ тоже придёт голосом.",
  consentTitle: "Сообщения и звонки от диспетчера",
  consentAsk: "Диспетчеру нужно ваше согласие, чтобы писать и звонить вам о грузах.",
  agree: "Согласен",
  decline: "Не сейчас",
  agreed: (d) => `Вы согласились ${d}. Напишите STOP в любой момент, чтобы остановить.`,
  declined: "Вы ответили «не сейчас». Диспетчер не будет писать, пока вы не согласитесь.",
  saving: "Сохраняем…",
  failed: "Не удалось сохранить. Попробуйте ещё раз.",
};

const uk: DispatchUi = {
  title: "Як з вами зв'язується диспетчер",
  alerts: {
    title: "Сповіщення",
    unsupported: "Цей телефон не показує сповіщення з веб-сторінки. На iPhone додайте Backroute на початковий екран (Поділитися → На початковий екран) і відкривайте звідти.",
    off: "Повідомлення від диспетчера на екрані блокування, щойно вони надійдуть.",
    on: "Увімкнено на цьому телефоні. SMS теж приходять, щоб нічого не пропустити.",
    blocked: "Сповіщення Backroute заборонені в налаштуваннях телефону. Дозвольте їх там і поверніться.",
    turnOn: "Увімкнути",
    turnOff: "Вимкнути",
    failed: "Не вдалося увімкнути. Спробуйте ще раз.",
  },
  textsBy: "Повідомлення приходять через",
  sms: "SMS",
  whatsapp: "WhatsApp",
  openWhatsApp: "Написати диспетчеру у WhatsApp",
  morning: "Ранкове повідомлення",
  morningNote: "Ваші зупинки, час, поради щодо доків і погода, до виїзду.",
  voice: "Голосові відповіді",
  voiceNote: "Надішліть голосове у WhatsApp, і відповідь теж прийде голосом.",
  consentTitle: "Повідомлення й дзвінки від диспетчера",
  consentAsk: "Диспетчеру потрібна ваша згода, щоб писати й дзвонити вам щодо вантажів.",
  agree: "Погоджуюся",
  decline: "Не зараз",
  agreed: (d) => `Ви погодилися ${d}. Напишіть STOP будь-коли, щоб зупинити.`,
  declined: "Ви відповіли «не зараз». Диспетчер не писатиме, поки ви не погодитеся.",
  saving: "Зберігаємо…",
  failed: "Не вдалося зберегти. Спробуйте ще раз.",
};

const fr: DispatchUi = {
  title: "Comment la répartition te joint",
  alerts: {
    title: "Notifications",
    unsupported: "Ce téléphone ne peut pas afficher les notifications d'une page web. Sur iPhone, ajoute Backroute à l'écran d'accueil (Partager → Sur l'écran d'accueil) et ouvre-le de là.",
    off: "Vois les messages de la répartition sur ton écran verrouillé dès qu'ils arrivent.",
    on: "Activées sur ce téléphone. Les textos arrivent aussi, pour ne rien manquer.",
    blocked: "Les notifications de Backroute sont bloquées dans les réglages du téléphone. Autorise-les là, puis reviens.",
    turnOn: "Activer",
    turnOff: "Désactiver",
    failed: "Impossible de les activer. Réessaie.",
  },
  textsBy: "Les messages arrivent par",
  sms: "Texto",
  whatsapp: "WhatsApp",
  openWhatsApp: "Écrire à la répartition sur WhatsApp",
  morning: "Message du matin",
  morningNote: "Tes arrêts, heures, conseils de quai et la météo, avant de partir.",
  voice: "Réponses vocales",
  voiceNote: "Envoie un message vocal sur WhatsApp et la réponse revient aussi en vocal.",
  consentTitle: "Textos et appels de la répartition",
  consentAsk: "La répartition a besoin de ton accord pour t'écrire et t'appeler au sujet de tes voyages.",
  agree: "J'accepte",
  decline: "Pas maintenant",
  agreed: (d) => `Tu as accepté le ${d}. Écris STOP quand tu veux pour arrêter.`,
  declined: "Tu as dit pas maintenant. La répartition ne t'écrira pas tant que tu n'acceptes pas.",
  saving: "Enregistrement…",
  failed: "Impossible d'enregistrer. Réessaie.",
};

export const DISPATCH_UI: Record<Lang, DispatchUi> = { en, es, pa, hi, ru, uk, fr };
