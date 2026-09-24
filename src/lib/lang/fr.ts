import type { CallPack } from "./pack";

// Quebec French, as drivers speak it on both sides of the border.
const hour = (h: number) => `${h} h`;
const day = (d: "today" | "tomorrow") => (d === "today" ? "aujourd'hui" : "demain");
const pl = (n: number, one: string, many: string) => (n <= 1 ? one : many);
const WEEKDAY = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

export const fr: CallPack = {
  hour,
  duration: (m) => (m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`),

  option: (o) => {
    const home = !o.home
      ? ""
      : o.home.kind === "tonight"
        ? " Tu couches chez vous ce soir."
        : o.home.kind === "late"
          ? " Ça finit tard, tu rentrerais tard."
          : o.home.kind === "near"
            ? " La livraison est tout près de chez vous."
            : ` Ça te laisse à environ ${o.home.hours} heures de la maison.`;
    return `${o.origin} à ${o.dest}, ${o.miles} milles, ramassage ${day(o.day)}. Tu ferais environ ${o.pay.toLocaleString()} $ sur ${o.move ? "ce mouvement" : "ce voyage"}.${home}`;
  },
  emptyAt: (kind, city) => (kind === "after" ? `pour après ta livraison à ${city}` : `à ${city}`),
  nextOpen: (name, emptyAt, option, count) =>
    `Salut ${name}, c'est ton répartiteur IA. J'ai un voyage ${emptyAt}. ${option}${count > 1 ? ` C'est le meilleur des ${count} que j'ai trouvés.` : ""} Tu le prends?`,
  nextMore: (option) => `Le suivant : ${option}`,
  booking: (origin, dest) => `C'est fait. Je réserve ${origin} à ${dest}. Je t'envoie les infos de ramassage par texto dès que la confirmation de tarif est signée. Tu changes d'idée? Dis « annule » dans les prochaines secondes.`,
  gone: "Celui-là est parti. Je regarde encore et je te rappelle.",
  cancelledLoad: "Annulé, rien n'est réservé. Les options sont encore sur ton écran d'accueil, et je te rappelle dans une trentaine de minutes. Les voyages partent vite, attends pas trop.",
  later: "Pas de problème. Ils sont sur ton écran d'accueil quand tu veux. Les voyages partent vite, je te rappelle dans une trentaine de minutes.",
  byeLoad: "Parfait. Bonne route.",

  numberKind: { pickup: "Numéro de ramassage", delivery: "Numéro de livraison", container: "Numéro de conteneur" },
  numberLine: (kind, spoken) => `${kind} : ${spoken}.`,
  pickupNotes: [
    "Enregistre-toi à la guérite avec ce numéro, ils vont te donner une porte",
    "Les camions entrent par la barrière arrière sur la voie de service, pas par le stationnement d'en avant",
    "C'est un chargement en direct, environ deux heures. Ton temps d'attente commence à l'enregistrement",
    "Le bureau d'expédition est à gauche en entrant. Ils veulent ton numéro de scellé sur le BOL",
  ],
  deliveryNotes: [
    "La réception est en arrière. Le numéro à appeler est sur l'affiche à la barrière",
    "Ils sont stricts sur les rendez-vous, enregistre-toi 15 minutes d'avance",
    "Ils déchargent, tu attends dans le camion. Fais signer le POD avant de repartir",
    "Pas de stationnement de nuit sur place, arrive pas la veille",
  ],
  apptAt: (h) => `Ton rendez-vous est à ${h}`,
  apptTomorrow7: "Ton rendez-vous est demain à 7 h",
  apptWindow: (a, b) => `Ils chargent entre ${a} et ${b}`,
  briefOpen: (p) =>
    `Salut ${p.name}, une petite chose avant que t'arrives. T'es à environ ${p.eta} de ${p.place} à ${p.city}. ${p.numberLine} ${p.note}. ${p.appt}, et j'ai déjà dit au courtier que t'es proche. Je t'ai tout envoyé par texto.`,
  repeatNumber: (line) => `${line} C'est aussi dans tes textos.`,
  lumper: (a) => `S'ils demandent un lumper, le courtier couvre jusqu'à ${a} $. Paye avec la carte de flotte, garde le reçu et prends-le en photo dans l'appli. Je le refacture.`,
  driveSafe: "Bonne route.",

  lateOpen: (p) =>
    `Attention, ${p.name}. Il y a un accident sur la ${p.road} plus loin, environ ${p.delay} minutes de plus. J'ai déjà appelé le receveur à ${p.city}, j'ai déplacé ton rendez-vous de ${p.was} à ${p.now} et j'ai avisé le courtier. T'as rien à faire.`,
  route: "J'ai pas de meilleure route que le GPS de ton camion. Faire le détour ajoute plus de milles que ça en sauve, alors rester là-dessus reste plus rapide.",

  stop: (brand, exit) => `le ${brand} à la sortie ${exit}`,
  parkOpen: (p) =>
    `${p.name}, il te reste ${p.hours < 1 ? "moins d'une heure" : `environ ${p.hours} heures`} de conduite et ${p.miles} milles à faire, donc tu te rendras pas au receveur aujourd'hui. J'ai déjà déplacé ta livraison à demain 7 h et avisé le courtier. ${p.stop.charAt(0).toUpperCase() + p.stop.slice(1)}, à ${p.ahead} milles, prend les réservations, ${p.cost} $ pour la nuit. Je te réserve une place? Ça se remplit vers 7 h le soir.`,
  reserved: (stop) => `Réservé. La place est au nom de ta compagnie au ${stop}, sur la carte de flotte. Dis « annule » si t'en veux pas.`,
  parkCancelled: "Annulé, aucune place réservée. Attends pas trop, ça se remplit vite.",
  parkOwn: "Correct. Attends pas trop, ça se remplit vite. La livraison est toujours demain à 7 h.",
  restUp: "Repose-toi. On se parle demain.",

  setupOpen: (name) => `Salut ${name}, c'est ton répartiteur IA. Trois petites questions pour t'appeler seulement quand ça vaut la peine. D'abord, à partir de quelle heure je peux t'appeler?`,
  setupQ2: (said) => `Parfait, ${said}. Et je t'appelle jamais quand t'es dans la couchette ou hors service; je t'écris. Y a-tu des états où tu veux pas aller?`,
  setupQ3: (said) => `${said.charAt(0).toUpperCase() + said.slice(1)}. Dernière question. Pour tes prochains voyages, tu veux un appel ou juste un texto?`,
  setupDone: (items) => `C'est réglé. ${items.join(". ")}. Tu peux tout changer dans ton profil. Bonne route.`,
  prefSaid: {
    "early:6": "je t'appelle pas avant 6 h",
    "early:8": "je t'appelle pas avant 8 h",
    "early:any": "je t'appelle n'importe quand quand t'es en service",
    "avoid:NJ": "je t'envoie pas au New Jersey ni à New York",
    "avoid:CA": "je t'envoie pas en Californie",
    "avoid:none": "je t'envoie là où ça paye",
    "loads:call": "je t'appelle pour les nouveaux voyages",
    "loads:text": "je t'écris les nouveaux voyages au lieu d'appeler",
  },
  prefLine: {
    noCallsBefore: (h) => `Pas d'appels avant ${h}`,
    anyTime: "Appels n'importe quand en service",
    noLoadsInto: (states) => `Pas de voyages vers ${states.join(" ni ")}`,
    anyState: "Voyages vers tous les états",
    loadsText: "Nouveaux voyages par texto",
    loadsCall: "Nouveaux voyages par appel",
  },
  stateName: { NJ: "le New Jersey", CA: "la Californie" },

  inOpen: (name) => `Salut ${name}, c'est la répartition. De quoi t'as besoin?`,
  bookedDesc: (o) => `${o.origin} à ${o.dest}, ${o.miles} milles, ramassage ${day(o.day)}`,
  inBooked: (desc) => `Ton prochain voyage est déjà réservé : ${desc}. Les détails sont sur ton écran d'accueil.`,
  inOptions: (count, emptyAt, option) => `J'ai ${count > 1 ? `${count} options` : "un voyage"} ${emptyAt}. Le meilleur : ${option} Tu le prends?`,
  inNothing: "Rien de réservé encore. Je regarde les babillards et je t'appelle dès que j'ai quelque chose de bon.",
  bdQ: "Correct. D'abord, es-tu sorti de la route et en sécurité?",
  bdSafe: "Bon. Je m'en occupe : je trouve le garage le plus proche qui peut venir te voir, et j'avise le courtier que le voyage est en retard. Allume tes clignotants, sors tes triangles. Je te rappelle avec l'heure d'arrivée.",
  bdDanger: "Si quelqu'un est blessé, raccroche et appelle le 911 d'abord. J'avise quelqu'un au bureau tout de suite, et j'ai commencé pour la remorqueuse et le garage.",
  lateQ: "T'as combien de retard?",
  lateAmount: { 30: "environ 30 minutes", 60: "environ une heure", 120: "deux heures ou plus" },
  lateConfirm: (a) => `Compris, ${a}. J'avise le receveur et le courtier et je demande de déplacer ton rendez-vous. Je t'écris la nouvelle heure. Bonne route.`,
  pay: (pay, n) => `Cette semaine, t'as fait ${pay} sur ${n} ${pl(n, "voyage", "voyages")} jusqu'ici. C'est payé le jour de paye habituel de ta compagnie. Je t'ai envoyé le détail par texto.`,
  payNone: "Rien de réglé encore cette semaine. Ta paye apparaît dans Gains dès qu'un voyage est livré.",
  inBye: "Quand tu veux. Bonne route.",

  person: "Bien sûr. Je demande à quelqu'un du bureau de te rappeler, d'habitude en moins de 10 minutes. Ce qu'on a réglé reste pareil.",
  sorry: "Désolé, j'ai pas compris.",
  saidAgain: "Peux-tu répéter?",
  saidPerson: "Je peux parler à quelqu'un?",
  ownerJoined: (name, owner) => `${name}, ${owner} du bureau vient de se joindre à l'appel. Je vous laisse parler et je prends des notes.`,

  ch: {
    bookIt: "Réserve-le", bookThis: "Réserve celui-là", whatElse: "Quoi d'autre?", bookFirst: "Réserve le premier", notNow: "Pas maintenant", cancelThat: "Annule", thanksBye: "Merci, bye",
    sayNumber: "Répète le numéro", lumperQ: "Et s'ils demandent un lumper?", gotIt: "Compris, merci", goAround: "Je fais un détour?", okThanks: "Correct, merci",
    bookSpot: "Réserve la place", findOwn: "Je vais m'en trouver une",
    early6: "6 h", early8: "8 h", earlyAny: "N'importe quand", avoidNJ: "Pas de New Jersey ni NYC", avoidCA: "Pas de Californie", avoidNone: "Je vais n'importe où", loadsCall: "Appelle-moi", loadsText: "Juste un texto",
    myNext: "Mon prochain voyage", brokeDown: "Je suis en panne", runningLate: "Je suis en retard", myPay: "Ma paye", thanks: "Merci",
    safeYes: "Oui, je suis en sécurité", dangerNo: "Non, j'ai besoin d'aide", late30: "Environ 30 minutes", late60: "Environ une heure", late120: "Deux heures ou plus",
    soundsGood: "Parfait", holdOn: "Une seconde",
  },

  txt: {
    booked: (short) => `Réservé pendant notre appel : ${short}. Les infos de ramassage suivent quand la confirmation de tarif est signée.`,
    options: (emptyAt, list) => `Options de voyage ${emptyAt} :\n${list.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nChoisis-en un sur ton écran d'accueil.`,
    brief: (p) => `${p.pickup ? "Ramassage" : "Livraison"} : ${p.place}, ${p.city}\n${p.numberKind} : ${p.number}\n${p.appt}\n${p.note}.`,
    late: (p) => `Ton rendez-vous à ${p.city} passe de ${p.was} à ${p.now} (accident sur la ${p.road}). Le courtier est au courant.`,
    parkReserved: (p) => `Stationnement réservé : ${p.stop}, à ${p.ahead} milles, ${p.cost} $ sur la carte de flotte. Livraison déplacée à demain 7 h.`,
    parkNot: (p) => `T'es à court d'heures avant le receveur. Livraison déplacée à demain 7 h. ${p.stop}, à ${p.ahead} milles, prend les réservations (${p.cost} $).`,
    setup: "Tes réglages d'appel sont enregistrés. Change-les quand tu veux dans ton profil.",
    inPay: (pay, n) => `Ta paye cette semaine jusqu'ici : ${pay} sur ${n} ${pl(n, "voyage", "voyages")}. Détail complet dans Gains.`,
    inBreakdown: "Panne enregistrée. L'IA trouve un garage et a avisé le courtier. Reste avec le camion; l'heure d'arrivée suit par appel et texto.",
    inLate: (a) => `Noté : retard de ${a}. On avise le receveur et le courtier; ta nouvelle heure de rendez-vous suit par texto.`,
    inGeneric: "De ton appel avec la répartition : question réglée.",
    autoBooked: (p) => `J'ai réservé ton prochain voyage : ${p.origin} → ${p.dest}, ${p.miles} milles, ramassage ${p.pickup}. Détails dans l'appli.`,
  },

  words: {
    numbers: [["un", "premier", "1"], ["deux", "deuxième", "2"], ["trois", "troisième", "3"], ["quatre", "quatrième", "4"]],
    again: ["répète", "encore", "quoi", "pardon"],
    person: ["quelqu'un", "personne", "humain", "bureau"],
    hangup: ["raccroche", "bye"],
  },

  quick: {
    oneMore: "Peux-tu faire un autre voyage aujourd'hui avant de rentrer?",
    callWhenParked: "Appelle-moi quand t'es stationné, pas de presse.",
    callBack: "Je vérifie ça et je te rappelle dans 10 minutes.",
    thanks: "Merci, tu fais du bon travail. Bonne route.",
  },

  daily: (p) =>
    [
      `${p.carrier}, ${WEEKDAY[p.weekday]} : ${p.delivered} ${pl(p.delivered, "voyage livré", "voyages livrés")}, ${p.profit} de profit.`,
      p.rolling ? `${p.rolling} ${pl(p.rolling, "camion roule", "camions roulent")} encore ce soir.` : "Tous les camions sont stationnés pour la nuit.",
      p.asks ? `${p.asks} ${pl(p.asks, "chose t'attend", "choses t'attendent")}. Détails dans l'appli.` : "Rien ne t'attend.",
      "Détails : backroute.app/today",
    ].join(" "),
};
