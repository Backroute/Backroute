import type { CallPack } from "./pack";

const hour = (h: number) => {
  const hr = ((h + 11) % 12) + 1;
  return `${hr === 1 ? "la 1" : `las ${hr}`} de la ${h < 12 ? "mañana" : h < 19 ? "tarde" : "noche"}`;
};
const day = (d: "today" | "tomorrow") => (d === "today" ? "hoy" : "mañana");
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export const es: CallPack = {
  hour,
  duration: (m) => (m < 60 ? `${m} minutos` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`),

  option: (o) => {
    const home = !o.home
      ? ""
      : o.home.kind === "tonight"
        ? " Duermes en casa esta noche."
        : o.home.kind === "late"
          ? " Termina tarde, así que llegarías tarde a casa."
          : o.home.kind === "near"
            ? " Entrega muy cerca de tu casa."
            : ` Te deja a unas ${o.home.hours} horas de casa.`;
    return `De ${o.origin} a ${o.dest}, ${o.miles} millas, se recoge ${day(o.day)}. Ganarías unos $${o.pay.toLocaleString()} en ${o.move ? "este movimiento" : "esta carga"}.${home}`;
  },
  emptyAt: (kind, city) => (kind === "after" ? `para después de entregar en ${city}` : `en ${city}`),
  nextOpen: (name, emptyAt, option, count) =>
    `Hola ${name}, habla tu despachador de IA. Tengo una carga ${emptyAt}. ${option}${count > 1 ? ` Es la mejor de ${count} que encontré.` : ""} ¿La quieres?`,
  nextMore: (option) => `La siguiente: ${option}`,
  booking: (origin, dest) => `Listo. Reservo la de ${origin} a ${dest}. Te mando los datos de recogida por mensaje cuando firmen la confirmación de tarifa. ¿Cambiaste de idea? Di "cancela" en los próximos segundos.`,
  gone: "Esa ya se fue. Busco otra vez y te llamo.",
  cancelledLoad: "Cancelado, no reservé nada. Las opciones siguen en tu pantalla de Inicio y te vuelvo a llamar en unos 30 minutos. Las cargas se van rápido, no esperes mucho.",
  later: "No hay problema. Están en tu pantalla de Inicio cuando quieras. Las cargas se van rápido, así que te llamo en unos 30 minutos.",
  byeLoad: "Perfecto. Maneja con cuidado.",

  numberKind: { pickup: "Número de recogida", delivery: "Número de entrega", container: "Número de contenedor" },
  numberLine: (kind, spoken) => `El ${kind.toLowerCase()} es ${spoken}.`,
  pickupNotes: [
    "Regístrate en la caseta del guardia con ese número y te dan una puerta",
    "Los camiones entran por el portón de atrás, por la calle de servicio, no por el estacionamiento de enfrente",
    "Es carga en vivo, unas dos horas. Tu tiempo de espera empieza a contar al registrarte",
    "La oficina de embarque está a la izquierda al entrar. Quieren tu número de sello en el BOL",
  ],
  deliveryNotes: [
    "Recibo está por atrás. El número para llamar está en el letrero del portón",
    "Son estrictos con las citas, regístrate 15 minutos antes",
    "Ellos descargan, tú esperas en el camión. Que te firmen el POD antes de salir",
    "No dejan estacionarse de noche, así que no llegues la noche anterior",
  ],
  apptAt: (h) => `Tu cita es a ${h}`,
  apptTomorrow7: "Tu cita es mañana a las 7 de la mañana",
  apptWindow: (a, b) => `Cargan entre ${a} y ${b}`,
  briefOpen: (p) =>
    `Hola ${p.name}, algo rápido antes de que llegues. Estás a unos ${p.eta} de ${p.place} en ${p.city}. ${p.numberLine} ${p.note}. ${p.appt}, y ya le avisé al bróker que estás cerca. Te mandé todo por mensaje.`,
  repeatNumber: (line) => `${line} También lo tienes en tus mensajes.`,
  lumper: (a) => `Si piden lumper, el bróker cubre hasta $${a}. Paga con la tarjeta de la flota, pide recibo y tómale foto en la app. Yo lo cobro.`,
  driveSafe: "Maneja con cuidado.",

  lateOpen: (p) =>
    `Ojo, ${p.name}. Hay un accidente en la ${p.road} más adelante, son unos ${p.delay} minutos más. Ya llamé al que recibe en ${p.city} y cambié tu cita de ${p.was} a ${p.now}, y le avisé al bróker. No tienes que hacer nada.`,
  route: "No tengo mejor ruta que el GPS de tu camión. Rodear este tramo suma más millas de las que ahorra, así que seguir por ahí sigue siendo más rápido.",

  stop: (brand, exit) => `el ${brand} de la salida ${exit}`,
  parkOpen: (p) =>
    `${p.name}, te quedan ${p.hours < 1 ? "menos de una hora" : `unas ${p.hours} horas`} de manejo y faltan ${p.miles} millas, así que hoy no llegas al que recibe. Ya moví tu entrega a mañana a las 7 de la mañana y le avisé al bróker. ${p.stop.charAt(0).toUpperCase() + p.stop.slice(1)}, a ${p.ahead} millas, acepta reservaciones, $${p.cost} la noche. ¿Te reservo un lugar? Por ahí se llenan como a las 7.`,
  reserved: (stop) => `Reservado. El lugar está a nombre de tu compañía en ${stop}, con la tarjeta de la flota. Di "cancela" si prefieres que no.`,
  parkCancelled: "Cancelado, no reservé nada. No lo dejes para muy tarde, esos lugares se llenan.",
  parkOwn: "Está bien. No lo dejes para muy tarde, esos lugares se llenan. La entrega sigue mañana a las 7.",
  restUp: "Descansa. Hablamos mañana.",

  setupOpen: (name) => `Hola ${name}, habla tu despachador de IA. Tres preguntas rápidas para solo llamarte cuando valga la pena. Primero, ¿desde qué hora te puedo llamar?`,
  setupQ2: (said) => `Entendido, ${said}. Y nunca te llamo cuando estás en la litera o fuera de servicio; te mando mensaje. ¿Hay estados a los que no quieras ir?`,
  setupQ3: (said) => `${said.charAt(0).toUpperCase() + said.slice(1)}. La última. Cuando encuentre tus próximas cargas, ¿prefieres llamada o solo mensaje?`,
  setupDone: (items) => `Todo listo. ${items.join(". ")}. Puedes cambiar cualquier cosa en tu Perfil. Maneja con cuidado.`,
  prefSaid: {
    "early:6": "no te llamo antes de las 6 de la mañana",
    "early:8": "no te llamo antes de las 8 de la mañana",
    "early:any": "te llamo a cualquier hora que estés en servicio",
    "avoid:NJ": "no te mando a Nueva Jersey ni a la ciudad",
    "avoid:CA": "no te mando a California",
    "avoid:none": "te mando a donde paguen bien",
    "loads:call": "te llamo con las cargas nuevas",
    "loads:text": "te mando las cargas nuevas por mensaje en vez de llamar",
  },
  prefLine: {
    noCallsBefore: (h) => `Sin llamadas antes de ${h}`,
    anyTime: "Llamadas a cualquier hora en servicio",
    noLoadsInto: (states) => `Sin cargas a ${states.join(" ni ")}`,
    anyState: "Cargas a cualquier estado",
    loadsText: "Cargas nuevas por mensaje",
    loadsCall: "Cargas nuevas por llamada",
  },
  stateName: { NJ: "Nueva Jersey", CA: "California" },

  inOpen: (name) => `Hola ${name}, habla despacho. ¿Qué necesitas?`,
  bookedDesc: (o) => `de ${o.origin} a ${o.dest}, ${o.miles} millas, se recoge ${day(o.day)}`,
  inBooked: (desc) => `Tu próxima carga ya está reservada: ${desc}. Los detalles están en tu pantalla de Inicio.`,
  inOptions: (count, emptyAt, option) => `Tengo ${count > 1 ? `${count} opciones` : "una"} ${emptyAt}. La mejor: ${option} ¿La quieres?`,
  inNothing: "Todavía no hay nada reservado. Estoy buscando en las bolsas de carga y te llamo en cuanto tenga algo bueno.",
  bdQ: "Está bien. Primero, ¿estás fuera de la carretera y a salvo?",
  bdSafe: "Bien. Ya me encargo: busco el taller más cercano que pueda ir a donde estás y le aviso al bróker que la carga va con retraso. Pon las intermitentes y los triángulos. Te llamo con la hora de llegada.",
  bdDanger: "Si alguien está herido, cuelga y llama primero al 911. Ya estoy avisando a alguien de la oficina y empecé con la grúa y el taller.",
  lateQ: "¿Qué tan tarde vas a llegar?",
  lateAmount: { 30: "unos 30 minutos", 60: "como una hora", 120: "dos horas o más" },
  lateConfirm: (a) => `Entendido, ${a}. Ya le aviso al que recibe y al bróker y pido que muevan tu cita. Te mando la nueva hora por mensaje. Maneja con cuidado.`,
  pay: (pay, n) => `Esta semana llevas ${pay} en ${n} ${pl(n, "carga", "cargas")}. Se paga el día normal de pago de tu compañía. Te mandé el desglose por mensaje.`,
  payNone: "Todavía no hay nada liquidado esta semana. Tu pago aparece en Ganancias en cuanto se entrega una carga.",
  inBye: "Cuando quieras. Maneja con cuidado.",

  person: "Claro. Le pido a alguien de la oficina que te llame, normalmente en menos de 10 minutos. Lo que ya arreglamos se queda igual.",
  personSupport: "Claro. Le pido a un especialista de soporte de Backroute que te llame, normalmente en menos de 10 minutos. Lo que ya arreglamos se queda igual.",
  sorry: "Perdón, no te entendí.",
  saidAgain: "¿Me lo repites?",
  saidPerson: "¿Puedo hablar con una persona?",
  ownerJoined: (name, owner) => `${name}, ${owner} de la oficina se acaba de unir. Los dejo hablar y yo tomo notas.`,

  ch: {
    bookIt: "Resérvala", bookThis: "Reserva esta", whatElse: "¿Qué más hay?", bookFirst: "Reserva la primera", notNow: "Ahora no", cancelThat: "Cancela eso", thanksBye: "Gracias, adiós",
    sayNumber: "Repite el número", lumperQ: "¿Y si piden lumper?", gotIt: "Entendido, gracias", goAround: "¿Me conviene rodear?", okThanks: "Está bien, gracias",
    bookSpot: "Reserva el lugar", findOwn: "Yo busco uno",
    early6: "6 de la mañana", early8: "8 de la mañana", earlyAny: "A cualquier hora", avoidNJ: "Nada de Nueva Jersey ni NYC", avoidCA: "Nada de California", avoidNone: "Voy a donde sea", loadsCall: "Llámame", loadsText: "Solo mándame mensaje",
    myNext: "Mi próxima carga", brokeDown: "Se me descompuso el camión", runningLate: "Voy tarde", myPay: "Mi pago", thanks: "Gracias",
    safeYes: "Sí, estoy a salvo", dangerNo: "No, necesito ayuda ya", late30: "Unos 30 minutos", late60: "Como una hora", late120: "Dos horas o más",
    soundsGood: "Me parece bien", holdOn: "Espera un segundo",
  },

  txt: {
    booked: (short) => `Reservada en nuestra llamada: ${short}. Los datos de recogida llegan cuando firmen la confirmación de tarifa.`,
    options: (emptyAt, list) => `Opciones de carga ${emptyAt}:\n${list.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nElige una en tu pantalla de Inicio.`,
    brief: (p) => `${p.pickup ? "Recogida" : "Entrega"}: ${p.place}, ${p.city}\n${p.numberKind}: ${p.number}\n${p.appt}\n${p.note}.`,
    late: (p) => `Tu cita en ${p.city} pasó de ${p.was} a ${p.now} (accidente en la ${p.road}). El bróker ya sabe.`,
    parkReserved: (p) => `Estacionamiento reservado: ${p.stop}, a ${p.ahead} millas, $${p.cost} con la tarjeta de la flota. Entrega movida a mañana a las 7.`,
    parkNot: (p) => `Te quedas sin horas antes de la entrega. Entrega movida a mañana a las 7. ${p.stop}, a ${p.ahead} millas, acepta reservaciones ($${p.cost}).`,
    setup: "Tus preferencias de llamada quedaron guardadas. Cámbialas cuando quieras en Perfil.",
    inPay: (pay, n) => `Tu pago de esta semana hasta ahora: ${pay} en ${n} ${pl(n, "carga", "cargas")}. Desglose completo en Ganancias.`,
    inBreakdown: "Avería registrada. La IA está buscando taller y ya le avisó al bróker. Quédate con el camión; la hora de llegada te llega por llamada y mensaje.",
    inLate: (a) => `Registrado: vas ${a} tarde. Estamos avisando al que recibe y al bróker; la nueva hora de tu cita te llega por mensaje.`,
    inGeneric: "De tu llamada con despacho: pregunta resuelta.",
    autoBooked: (p) => `Reservé tu próxima carga: ${p.origin} → ${p.dest}, ${p.miles} millas, se recoge ${p.pickup}. Detalles en la app.`,
  },

  words: {
    numbers: [["uno", "primera", "primero", "1"], ["dos", "segunda", "segundo", "2"], ["tres", "tercera", "tercero", "3"], ["cuatro", "cuarta", "cuarto", "4"]],
    again: ["repite", "otra vez", "de nuevo", "cómo", "qué dijiste"],
    person: ["persona", "humano", "alguien", "oficina"],
    hangup: ["cuelga", "adiós"],
  },

  quick: {
    oneMore: "¿Puedes hacer una carga más hoy antes de irte a casa?",
    callWhenParked: "Llámame cuando te estaciones, sin prisa.",
    callBack: "Déjame revisar eso y te llamo en 10 minutos.",
    thanks: "Gracias, vas muy bien. Maneja con cuidado.",
  },

  owner: {
    greetFleet: "Despachador de IA. ¿Qué necesitas de tu flota?",
    greetLoad: (o, d, b) => `Te llamo por la carga ${o} → ${d} con ${b}. ¿Qué quieres que le pida?`,
    ack: {
      rate: (b) => `Ya voy. Se lo llevo a ${b} ahora mismo y te confirmo en cuanto contesten.`,
      detention: (b) => `Entendido. Le pido a ${b} que confirme detención y lumper en esta.`,
      schedule: (b) => `Entendido. Reviso con ${b} si hay flexibilidad en la ventana de recogida.`,
      payment: (b) => `Ya voy. Le pregunto a ${b} por pago rápido en esta carga.`,
      general: "Entendido. Se lo paso al bróker ahora.",
    },
    quickFleet: ["¿Qué necesita mi atención?", "¿Cómo va la ganancia?", "¿Cuántos camiones hay libres?", "¿Hay inspecciones DOT pendientes?"],
    quickLoad: ["Pide mejor tarifa", "Pregunta por detención", "Pregunta por la ventana de recogida", "Pregunta por pago rápido"],
  },

  daily: (p) =>
    [
      `${p.carrier}, ${WEEKDAY[p.weekday]}: ${p.delivered} ${pl(p.delivered, "carga entregada", "cargas entregadas")}, ${p.profit} de ganancia.`,
      p.rolling ? `${p.rolling} ${pl(p.rolling, "camión sigue", "camiones siguen")} en ruta esta noche.` : "Todos los camiones estacionados por la noche.",
      p.asks ? `${p.asks} ${pl(p.asks, "cosa te necesita", "cosas te necesitan")}. Detalles en la app.` : "Nada te necesita.",
      "Detalles: backroute.app/today",
    ].join(" "),
};
