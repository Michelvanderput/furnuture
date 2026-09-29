import type { Category, Item, Room, RoomType } from "./types";

/**
 * What a room usually needs, per kind of room: a checklist to put on the list with
 * one tap, as "still to find" items with a rough price. Three price levels:
 * budget (IKEA, JYSK, Leen Bakker), midden (Kwantum, fonQ, Karwei, Beter Bed) and
 * luxe (Loods 5, design brands, a specialist shop). Prices are per piece in euros.
 */

export type Tier = 0 | 1 | 2;
export const TIERS: { id: Tier; label: string; hint: string }[] = [
  { id: 0, label: "Budget", hint: "IKEA, JYSK, Leen Bakker, Action" },
  { id: 1, label: "Midden", hint: "Kwantum, fonQ, Karwei, Beter Bed" },
  { id: 2, label: "Luxe", hint: "Loods 5, designmerken, speciaalzaak" },
];

export interface Entry {
  title: string;
  category: Category;
  /** Price per piece at each level. */
  price: [number, number, number];
  qty?: number;
  must?: boolean;
  /** Size or buying tip. */
  hint?: string;
}
export interface Group {
  name: string;
  items: Entry[];
}

/** Which list a room gets; bedrooms come in several kinds. */
export type Profile =
  | "woonkamer"
  | "eetkamer"
  | "keuken"
  | "hoofdslaapkamer"
  | "slaapkamer"
  | "kinderkamer"
  | "babykamer"
  | "logeerkamer"
  | "werkkamer"
  | "badkamer"
  | "toilet"
  | "hal"
  | "zolder"
  | "berging"
  | "wasruimte"
  | "tuin"
  | "balkon";

const e = (title: string, category: Category, price: [number, number, number], opts: Partial<Omit<Entry, "title" | "category" | "price">> = {}): Entry => ({
  title,
  category,
  price,
  ...opts,
});
const must = { must: true };

// Shared groups ----------------------------------------------------------------

const WINDOW = (hint = "Meet de ramen op voor je bestelt; maatwerk heeft 2 à 4 weken levertijd."): Group => ({
  name: "Ramen",
  items: [
    e("Gordijnen", "raamdecoratie", [40, 150, 450], { ...must, hint }),
    e("Gordijnrails of -roede", "raamdecoratie", [15, 40, 120], { ...must }),
    e("Vitrage of inbetweens", "raamdecoratie", [25, 80, 250]),
  ],
});

// The lists --------------------------------------------------------------------

export const CATALOG: Record<Profile, { label: string; groups: Group[] }> = {
  woonkamer: {
    label: "Woonkamer",
    groups: [
      {
        name: "Zitten",
        items: [
          e("Bank", "banken", [350, 1100, 2800], { ...must, hint: "3-zits ± 200 cm, hoekbank ± 280 × 200 cm. Levertijd vaak 6–12 weken: bestel op tijd." }),
          e("Fauteuil of loveseat", "banken", [120, 450, 1200]),
          e("Poef of hocker", "banken", [40, 120, 350]),
          e("Sierkussens", "decoratie", [8, 25, 60], { qty: 4 }),
          e("Plaid", "decoratie", [15, 40, 120]),
        ],
      },
      {
        name: "Tafels",
        items: [
          e("Salontafel", "tafels", [50, 250, 800], { ...must, hint: "± 2/3 van de lengte van de bank; 40–45 cm van de bank." }),
          e("Bijzettafel", "tafels", [20, 80, 250]),
        ],
      },
      {
        name: "Opbergen en tv",
        items: [
          e("Tv-meubel", "kasten", [80, 350, 1100], { ...must, hint: "Minstens zo breed als de tv." }),
          e("Televisie", "overig", [350, 800, 2000]),
          e("Tv-beugel", "overig", [25, 70, 180]),
          e("Boekenkast of vakkenkast", "kasten", [60, 300, 1200]),
          e("Dressoir", "kasten", [150, 500, 1500]),
          e("Wandplanken", "kasten", [15, 50, 150], { qty: 2 }),
        ],
      },
      {
        name: "Verlichting",
        items: [
          e("Plafondlamp", "verlichting", [30, 120, 450], { ...must }),
          e("Vloerlamp (leeslamp)", "verlichting", [30, 120, 450], { ...must }),
          e("Tafellamp", "verlichting", [20, 70, 250], { qty: 2 }),
          e("Slimme lampen of dimmer", "verlichting", [15, 40, 90], { qty: 3 }),
        ],
      },
      {
        name: "Vloer en ramen",
        items: [
          e("Vloerkleed", "vloerkleden", [60, 250, 900], { ...must, hint: "Voorpoten van de bank erop: ± 200 × 300 cm." }),
          ...WINDOW().items,
        ],
      },
      {
        name: "Sfeer",
        items: [
          e("Grote kamerplant", "planten", [25, 60, 150]),
          e("Plantenpotten", "planten", [10, 30, 90], { qty: 3 }),
          e("Wanddecoratie of posters met lijst", "decoratie", [20, 70, 250], { qty: 3 }),
          e("Spiegel", "decoratie", [30, 120, 400]),
          e("Vaas en accessoires", "decoratie", [15, 40, 120]),
        ],
      },
    ],
  },

  eetkamer: {
    label: "Eethoek",
    groups: [
      {
        name: "Eten",
        items: [
          e("Eettafel", "tafels", [150, 600, 1800], { ...must, hint: "4 personen ± 140 cm, 6 personen ± 180–200 cm; ± 80 cm ruimte rond de tafel." }),
          e("Eetkamerstoelen", "stoelen", [35, 120, 350], { ...must, qty: 4 }),
          e("Hanglamp boven de tafel", "verlichting", [40, 150, 600], { ...must, hint: "Onderkant ± 60–70 cm boven het tafelblad." }),
          e("Stoelkussens", "decoratie", [8, 20, 45], { qty: 4 }),
          e("Buffetkast of vitrinekast", "kasten", [150, 500, 1400]),
          e("Tafelkleed of placemats", "decoratie", [15, 40, 90]),
        ],
      },
    ],
  },

  keuken: {
    label: "Keuken",
    groups: [
      {
        name: "Apparaten",
        items: [
          e("Koelkast (als die er niet is)", "keuken", [350, 750, 1800]),
          e("Vaatwasser (als die er niet is)", "keuken", [350, 600, 1100]),
          e("Magnetron of combi-oven", "keuken", [80, 250, 900]),
          e("Waterkoker", "keuken", [20, 50, 120], { ...must }),
          e("Koffiezetapparaat", "keuken", [40, 250, 900], { ...must }),
          e("Broodrooster", "keuken", [20, 45, 120]),
          e("Airfryer", "keuken", [60, 130, 250]),
          e("Staafmixer", "keuken", [20, 50, 120]),
        ],
      },
      {
        name: "Koken",
        items: [
          e("Pannenset (geschikt voor inductie)", "keuken", [50, 180, 500], { ...must, hint: "Check of de kookplaat inductie is: dan werken niet alle pannen." }),
          e("Koekenpan", "keuken", [15, 45, 120], { ...must }),
          e("Messenset en snijplank", "keuken", [25, 80, 300], { ...must }),
          e("Keukengerei (spatel, pollepel, garde…)", "keuken", [15, 35, 80], { ...must }),
          e("Ovenschalen en bakvormen", "keuken", [20, 50, 120]),
          e("Vergiet, maatbeker, weegschaal", "keuken", [15, 35, 70]),
        ],
      },
      {
        name: "Servies en bestek",
        items: [
          e("Servies (borden, kommen)", "keuken", [30, 90, 250], { ...must, hint: "Voor 6 personen; reken ook op visite." }),
          e("Bestekset", "keuken", [20, 60, 180], { ...must }),
          e("Glazen", "keuken", [15, 40, 120], { ...must }),
          e("Mokken", "keuken", [10, 30, 70]),
          e("Vershoudbakjes", "keuken", [10, 25, 60]),
        ],
      },
      {
        name: "Opruimen en schoonmaken",
        items: [
          e("Afvalbak (met scheiding)", "keuken", [25, 80, 200], { ...must }),
          e("Afwasrek of droogmat", "keuken", [10, 25, 60]),
          e("Theedoeken en vaatdoekjes", "keuken", [10, 20, 40], { ...must }),
          e("Brandblusdeken", "overig", [15, 25, 40], { ...must, hint: "Hangt binnen handbereik van het fornuis." }),
        ],
      },
      {
        name: "Inrichting",
        items: [
          e("Barkrukken", "stoelen", [35, 110, 300], { qty: 2 }),
          e("Keukenverlichting (onderbouw of spots)", "verlichting", [25, 90, 300]),
          e("Rolgordijn of jaloezie", "raamdecoratie", [25, 70, 200]),
          e("Kruidenrek of opbergpotten", "keuken", [15, 35, 90]),
        ],
      },
    ],
  },

  hoofdslaapkamer: {
    label: "Hoofdslaapkamer",
    groups: [
      {
        name: "Bed",
        items: [
          e("Bed of boxspring", "bedden", [250, 1200, 3000], { ...must, hint: "160 × 200 of 180 × 200. Boxsprings hebben vaak 4–8 weken levertijd." }),
          e("Matras", "bedden", [150, 600, 1500], { ...must, hint: "Bij een los bed; bij een boxspring zit hij er vaak bij." }),
          e("Topper", "bedden", [60, 200, 450]),
          e("Hoofdkussens", "bedden", [15, 50, 120], { ...must, qty: 2 }),
          e("Dekbed", "bedden", [40, 150, 400], { ...must }),
          e("Dekbedovertrekken", "bedden", [25, 60, 150], { ...must, qty: 2 }),
          e("Hoeslakens", "bedden", [15, 35, 70], { ...must, qty: 2 }),
          e("Matrasbeschermer", "bedden", [15, 40, 80]),
        ],
      },
      {
        name: "Naast het bed",
        items: [
          e("Nachtkastjes", "kasten", [25, 120, 350], { ...must, qty: 2 }),
          e("Bedlampjes of wandlampjes", "verlichting", [20, 60, 180], { qty: 2 }),
        ],
      },
      {
        name: "Kleding",
        items: [
          e("Kledingkast", "kasten", [150, 700, 2500], { ...must, hint: "Maatwerk en PAX hebben levertijd; meet de nis en schuine plafonds." }),
          e("Ladekast of commode", "kasten", [80, 300, 800]),
          e("Passpiegel", "decoratie", [30, 100, 300]),
          e("Wasmand", "overig", [15, 35, 80]),
        ],
      },
      {
        name: "Verlichting, vloer en ramen",
        items: [
          e("Plafondlamp", "verlichting", [25, 90, 300], { ...must }),
          e("Verduisterende gordijnen of rolgordijn", "raamdecoratie", [40, 160, 500], { ...must, hint: "Verduisterend slaapt beter; maatwerk 2–4 weken." }),
          e("Gordijnrails", "raamdecoratie", [15, 40, 120], { ...must }),
          e("Vloerkleed naast of onder het bed", "vloerkleden", [40, 180, 600]),
          e("Stoel of fauteuil", "stoelen", [60, 200, 600]),
        ],
      },
    ],
  },

  slaapkamer: {
    label: "Slaapkamer",
    groups: [
      {
        name: "Bed",
        items: [
          e("Bed", "bedden", [150, 450, 1200], { ...must, hint: "90 × 200 of 140 × 200." }),
          e("Matras", "bedden", [100, 350, 900], { ...must }),
          e("Hoofdkussen", "bedden", [15, 40, 90], { ...must }),
          e("Dekbed", "bedden", [30, 100, 300], { ...must }),
          e("Dekbedovertrekken", "bedden", [20, 45, 110], { ...must, qty: 2 }),
          e("Hoeslakens", "bedden", [12, 25, 55], { ...must, qty: 2 }),
          e("Nachtkastje", "kasten", [20, 90, 250]),
        ],
      },
      {
        name: "Opbergen",
        items: [e("Kledingkast", "kasten", [100, 400, 1500], { ...must }), e("Ladekast", "kasten", [60, 200, 600])],
      },
      {
        name: "Licht en ramen",
        items: [
          e("Plafondlamp", "verlichting", [20, 70, 250], { ...must }),
          e("Bureaulamp of leeslamp", "verlichting", [15, 50, 150]),
          e("Gordijnen of rolgordijn", "raamdecoratie", [30, 120, 400], { ...must }),
          e("Gordijnrails", "raamdecoratie", [15, 35, 100], { ...must }),
          e("Vloerkleed", "vloerkleden", [30, 120, 400]),
        ],
      },
    ],
  },

  kinderkamer: {
    label: "Kinderkamer",
    groups: [
      {
        name: "Slapen",
        items: [
          e("Kinderbed of hoogslaper", "bedden", [120, 400, 1100], { ...must }),
          e("Matras", "bedden", [80, 200, 450], { ...must }),
          e("Dekbed en kussen", "bedden", [30, 80, 180], { ...must }),
          e("Dekbedovertrekken", "bedden", [20, 40, 80], { ...must, qty: 2 }),
          e("Nachtlampje", "verlichting", [10, 25, 60]),
        ],
      },
      {
        name: "Spelen en opbergen",
        items: [
          e("Speelgoedkast of opbergbakken", "kasten", [40, 150, 400], { ...must }),
          e("Kledingkast", "kasten", [80, 300, 900], { ...must }),
          e("Bureau en stoel", "tafels", [60, 200, 500]),
          e("Speelkleed of vloerkleed", "vloerkleden", [25, 80, 250]),
          e("Boekenrekje", "kasten", [20, 60, 150]),
        ],
      },
      {
        name: "Licht en ramen",
        items: [
          e("Plafondlamp", "verlichting", [20, 60, 180], { ...must }),
          e("Verduisterend rolgordijn", "raamdecoratie", [30, 90, 250], { ...must }),
          e("Gordijnen", "raamdecoratie", [30, 90, 250]),
          e("Muurstickers of posters", "decoratie", [15, 40, 100]),
        ],
      },
    ],
  },

  babykamer: {
    label: "Babykamer",
    groups: [
      {
        name: "Slapen en verzorgen",
        items: [
          e("Babybed of ledikant", "bedden", [100, 300, 800], { ...must }),
          e("Matras voor het ledikant", "bedden", [40, 100, 200], { ...must }),
          e("Slaapzakken en hoeslakens", "bedden", [30, 70, 150], { ...must }),
          e("Commode met aankleedkussen", "kasten", [100, 350, 900], { ...must }),
          e("Babyfoon", "overig", [40, 120, 300], { ...must }),
          e("Voedingsstoel of schommelstoel", "stoelen", [80, 300, 900]),
        ],
      },
      {
        name: "Opbergen en sfeer",
        items: [
          e("Kledingkast", "kasten", [80, 300, 900], { ...must }),
          e("Verduisterend rolgordijn", "raamdecoratie", [30, 90, 250], { ...must }),
          e("Nachtlampje", "verlichting", [10, 30, 80], { ...must }),
          e("Plafondlamp", "verlichting", [20, 60, 180]),
          e("Vloerkleed", "vloerkleden", [30, 100, 300]),
          e("Opbergmanden", "decoratie", [15, 35, 80], { qty: 2 }),
        ],
      },
    ],
  },

  logeerkamer: {
    label: "Logeerkamer",
    groups: [
      {
        name: "Logees",
        items: [
          e("Slaapbank of logeerbed", "banken", [200, 600, 1500], { ...must, hint: "Een slaapbank maakt er ook een werk- of speelkamer van." }),
          e("Matras of topper", "bedden", [80, 250, 600]),
          e("Beddengoed (set)", "bedden", [40, 90, 200], { ...must }),
          e("Handdoekenset voor gasten", "overig", [20, 45, 90]),
          e("Kledingrek of kleine kast", "kasten", [25, 120, 400]),
          e("Plafondlamp", "verlichting", [20, 60, 180], { ...must }),
          e("Gordijnen of rolgordijn", "raamdecoratie", [30, 100, 300], { ...must }),
        ],
      },
    ],
  },

  werkkamer: {
    label: "Werkkamer",
    groups: [
      {
        name: "Werkplek",
        items: [
          e("Bureau (liefst zit-sta)", "tafels", [80, 350, 900], { ...must, hint: "Zit-sta scheelt rugklachten; ± 140 × 70 cm." }),
          e("Bureaustoel", "stoelen", [80, 300, 900], { ...must }),
          e("Bureaulamp", "verlichting", [20, 60, 200], { ...must }),
          e("Monitor", "overig", [120, 300, 700]),
          e("Monitorarm", "overig", [30, 80, 200]),
          e("Kabelgoot en stekkerdoos", "overig", [15, 35, 70], { ...must }),
        ],
      },
      {
        name: "Opbergen en rust",
        items: [
          e("Boekenkast of archiefkast", "kasten", [60, 250, 800], { ...must }),
          e("Ladeblok", "kasten", [40, 120, 300]),
          e("Plafondlamp", "verlichting", [20, 70, 250], { ...must }),
          e("Rolgordijn of jaloezie (tegen schittering)", "raamdecoratie", [25, 80, 250], { ...must }),
          e("Vloerkleed of stoelmat", "vloerkleden", [25, 80, 250]),
          e("Plant", "planten", [15, 40, 100]),
        ],
      },
    ],
  },

  badkamer: {
    label: "Badkamer",
    groups: [
      {
        name: "Textiel",
        items: [
          e("Handdoeken en badlakens", "overig", [30, 80, 180], { ...must, hint: "Reken 4 per persoon." }),
          e("Badmat", "vloerkleden", [10, 25, 60], { ...must }),
          e("Douchegordijn of -wand (als die ontbreekt)", "sanitair", [20, 250, 700]),
          e("Badjassen", "overig", [25, 50, 110], { qty: 2 }),
        ],
      },
      {
        name: "Opbergen",
        items: [
          e("Spiegel of spiegelkast", "sanitair", [40, 180, 600], { ...must }),
          e("Badkamerkast of rek", "kasten", [40, 150, 500]),
          e("Handdoekhaakjes of -rek", "sanitair", [10, 35, 100], { ...must }),
          e("Doucherekje of -nis", "sanitair", [15, 40, 120], { ...must }),
          e("Wasmand", "overig", [15, 35, 80], { ...must }),
        ],
      },
      {
        name: "Klein maar nodig",
        items: [
          e("Zeepdispenser, bekers en bakjes", "decoratie", [10, 30, 80], { ...must }),
          e("Pedaalemmer", "overig", [10, 25, 60], { ...must }),
          e("Weegschaal", "overig", [15, 35, 80]),
          e("Badkamerverlichting (spiegellamp)", "verlichting", [25, 80, 250]),
        ],
      },
    ],
  },

  toilet: {
    label: "Toilet",
    groups: [
      {
        name: "Toilet",
        items: [
          e("Toiletborstel en rolhouder", "sanitair", [10, 30, 90], { ...must }),
          e("Toiletbril (als je die vervangt)", "sanitair", [20, 50, 120]),
          e("Handdoekje en haakje", "overig", [8, 20, 45], { ...must }),
          e("Zeeppompje", "decoratie", [5, 15, 40], { ...must }),
          e("Pedaalemmertje", "overig", [8, 20, 45]),
          e("Spiegeltje", "decoratie", [10, 30, 90]),
          e("Lamp", "verlichting", [15, 40, 120]),
        ],
      },
    ],
  },

  hal: {
    label: "Hal en overloop",
    groups: [
      {
        name: "Binnenkomen",
        items: [
          e("Kapstok of garderobe", "kasten", [30, 150, 500], { ...must }),
          e("Schoenenkast of -rek", "kasten", [30, 120, 400], { ...must }),
          e("Deurmat (binnen)", "vloerkleden", [15, 35, 80], { ...must }),
          e("Spiegel", "decoratie", [30, 100, 300]),
          e("Sleutelkastje of -haakjes", "decoratie", [10, 25, 60]),
          e("Halkastje of wandtafel", "kasten", [40, 150, 500]),
        ],
      },
      {
        name: "Licht en veiligheid",
        items: [
          e("Plafondlampen", "verlichting", [20, 70, 250], { ...must, qty: 2 }),
          e("Loper voor de gang of trap", "vloerkleden", [30, 100, 300]),
          e("Rookmelders", "overig", [15, 30, 60], { ...must, qty: 2, hint: "Verplicht op elke verdieping met een vluchtroute." }),
          e("Traphekje (met kleine kinderen)", "overig", [25, 50, 100]),
        ],
      },
    ],
  },

  zolder: {
    label: "Zolder",
    groups: [
      {
        name: "Zolder",
        items: [
          e("Opbergrekken", "kasten", [40, 120, 300], { ...must }),
          e("Opbergboxen", "overig", [8, 15, 30], { qty: 6 }),
          e("Knieschotkasten (maatwerk)", "kasten", [150, 600, 2000]),
          e("Dakraam-rolgordijn", "raamdecoratie", [40, 90, 200], { ...must, hint: "Passend bij het merk en type dakraam (Velux-code op het raam)." }),
          e("Plafondlamp", "verlichting", [20, 60, 180], { ...must }),
        ],
      },
    ],
  },

  berging: {
    label: "Berging en schuur",
    groups: [
      {
        name: "Berging",
        items: [
          e("Stellingkast", "kasten", [30, 90, 250], { ...must }),
          e("Gereedschapskist of -set", "overig", [30, 80, 250], { ...must, hint: "Boormachine, waterpas, schroevendraaiers: je hebt ze de eerste week nodig." }),
          e("Accuboormachine", "overig", [50, 120, 300], { ...must }),
          e("Trapje", "overig", [30, 60, 150], { ...must }),
          e("Fietsophanging of -rek", "overig", [15, 40, 100]),
          e("Opbergboxen", "overig", [8, 15, 30], { qty: 4 }),
          e("Tl- of ledlamp", "verlichting", [15, 35, 80]),
        ],
      },
    ],
  },

  wasruimte: {
    label: "Wasruimte",
    groups: [
      {
        name: "Wassen",
        items: [
          e("Wasmachine", "overig", [350, 600, 1100], { ...must }),
          e("Droger", "overig", [350, 650, 1200]),
          e("Wasmachine-verhoger of stapelkit", "overig", [20, 50, 120]),
          e("Droogrek", "overig", [20, 45, 100], { ...must }),
          e("Wasmanden", "overig", [15, 30, 60], { qty: 2 }),
          e("Strijkplank en strijkijzer", "overig", [40, 100, 250]),
          e("Stofzuiger", "overig", [80, 250, 600], { ...must }),
          e("Emmer, dweil en schoonmaakspullen", "overig", [20, 45, 90], { ...must }),
        ],
      },
    ],
  },

  tuin: {
    label: "Tuin",
    groups: [
      {
        name: "Buiten zitten",
        items: [
          e("Tuinset (tafel en stoelen)", "tafels", [150, 600, 2000], { ...must }),
          e("Loungeset", "banken", [300, 900, 3000]),
          e("Parasol of schaduwdoek", "overig", [40, 200, 800], { ...must }),
          e("Buitenkussens en opbergbox", "decoratie", [40, 120, 300]),
          e("Buitenlamp of lichtsnoer", "verlichting", [20, 70, 250]),
          e("Barbecue", "overig", [50, 300, 1200]),
        ],
      },
      {
        name: "Onderhoud",
        items: [
          e("Tuinslang met haspel", "overig", [25, 60, 150], { ...must }),
          e("Tuingereedschap (schep, hark, snoeischaar)", "overig", [30, 70, 180], { ...must }),
          e("Grasmaaier", "overig", [80, 250, 700]),
          e("Plantenbakken en planten", "planten", [30, 100, 400]),
          e("Buitenkraan-afsluiting voor de winter", "overig", [5, 10, 20]),
        ],
      },
    ],
  },

  balkon: {
    label: "Balkon of terras",
    groups: [
      {
        name: "Balkon",
        items: [
          e("Bistroset of klapstoelen", "stoelen", [50, 150, 400], { ...must }),
          e("Balkonplanten en bakken", "planten", [20, 60, 180]),
          e("Buitenkleed", "vloerkleden", [25, 70, 200]),
          e("Lichtsnoer of buitenlamp", "verlichting", [15, 40, 120]),
          e("Windscherm of balkondoek", "overig", [20, 50, 150]),
        ],
      },
    ],
  },
};

/** The list that fits a room best: by kind, and by name for bedrooms, dining and storage. */
export function profileFor(room: Room, rooms: Room[] = []): Profile {
  const n = room.name.toLowerCase();
  switch (room.type) {
    case "woonkamer":
      return /eet/.test(n) && !/woon/.test(n) ? "eetkamer" : "woonkamer";
    case "keuken":
      return "keuken";
    case "slaapkamer": {
      if (/baby/.test(n)) return "babykamer";
      if (/kind|kids|jongen|meisje/.test(n)) return "kinderkamer";
      if (/logeer|gast/.test(n)) return "logeerkamer";
      if (/hoofd|master|ouder/.test(n)) return "hoofdslaapkamer";
      // Otherwise the main bedroom is the largest (or, without sizes, the first) one, unless another is named so.
      const beds = rooms.filter((r) => r.type === "slaapkamer");
      if (beds.some((r) => /hoofd|master|ouder/.test(r.name.toLowerCase()))) return "slaapkamer";
      const main = beds.some((r) => r.area) ? [...beds].sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0] : beds[0];
      return !main || main.id === room.id ? "hoofdslaapkamer" : "slaapkamer";
    }
    case "werkkamer":
      return "werkkamer";
    case "badkamer":
      return "badkamer";
    case "toilet":
      return "toilet";
    case "hal":
      return "hal";
    case "zolder":
      return /was/.test(n) ? "wasruimte" : "zolder";
    case "tuin":
      return /balkon|terras|dakterras/.test(n) ? "balkon" : "tuin";
    case "buitenkant":
      return "tuin";
    default:
      if (/was|bijkeuken/.test(n)) return "wasruimte";
      if (/balkon|terras/.test(n)) return "balkon";
      if (/werk|kantoor/.test(n)) return "werkkamer";
      return "berging";
  }
}

/** Kinds of room that have a list at all (not the floor plan). */
export const hasCatalog = (room: Room) => room.type !== "plattegrond";

/** Profiles to choose from, per room type (a second bedroom may be a study). */
export function profileChoices(type: RoomType): Profile[] {
  if (type === "slaapkamer") return ["hoofdslaapkamer", "slaapkamer", "kinderkamer", "babykamer", "logeerkamer", "werkkamer"];
  if (type === "woonkamer") return ["woonkamer", "eetkamer"];
  if (type === "werkkamer") return ["werkkamer", "logeerkamer", "slaapkamer"];
  if (type === "zolder") return ["zolder", "werkkamer", "logeerkamer", "wasruimte"];
  if (type === "tuin" || type === "buitenkant") return ["tuin", "balkon"];
  if (type === "overig") return ["berging", "wasruimte", "werkkamer", "logeerkamer"];
  return [];
}

/** The groups for a room: a living room also gets the dining corner (most Dutch living rooms have one). */
export function groupsFor(profile: Profile): Group[] {
  const groups = CATALOG[profile].groups;
  return profile === "woonkamer" ? [...groups, ...CATALOG.eetkamer.groups.map((g) => ({ ...g, name: "Eethoek" }))] : groups;
}

export const entries = (profile: Profile) => groupsFor(profile).flatMap((g) => g.items);
export const entryCost = (x: Entry, tier: Tier) => x.price[tier] * (x.qty ?? 1);

/** Already on the list: an item made from it, or with the same name. */
export function onList(items: Item[], roomId: string, x: Entry): boolean {
  const t = x.title.toLowerCase();
  return items.some((i) => i.roomId === roomId && (i.suggestion?.toLowerCase() === t || i.title.toLowerCase() === t));
}

/** A catalogue entry as a "still to find" item in a room. */
export function itemFrom(x: Entry, roomId: string, tier: Tier, id: string): Item {
  return {
    id,
    roomId,
    title: x.title,
    images: [],
    estimate: x.price[tier],
    qty: x.qty ?? 1,
    category: x.category,
    status: "idee",
    must: !!x.must,
    note: "",
    why: x.hint,
    suggestion: x.title,
    addedAt: Date.now(),
    source: "manual",
  };
}

/** What the must-haves (and everything) of all rooms would cost: a starting point for the budget. */
export function houseEstimate(rooms: Room[], tier: Tier): { must: number; all: number } {
  let mustSum = 0;
  let all = 0;
  for (const r of rooms) {
    if (!hasCatalog(r)) continue;
    for (const x of entries(profileFor(r, rooms))) {
      const c = entryCost(x, tier);
      all += c;
      if (x.must) mustSum += c;
    }
  }
  return { must: mustSum, all };
}

// Tier: per device (a preference, not part of the house).
const TIER_KEY = "furnuture:tier";
export const tierPref = {
  get: (): Tier => {
    try {
      const v = localStorage.getItem(TIER_KEY);
      return v === "0" ? 0 : v === "2" ? 2 : 1;
    } catch {
      return 1;
    }
  },
  set: (t: Tier) => {
    try {
      localStorage.setItem(TIER_KEY, String(t));
    } catch {
      // private mode
    }
  },
};
