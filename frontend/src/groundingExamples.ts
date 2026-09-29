/** Source texts and assistant answers for the grounding demo. Kept free of React so scripts can import it. */

type Lang = "pl" | "en";
type Text = Record<Lang, string>;

export type GroundingExample = { id: string; title: Text; source: Text; answer: Text };

const WARRANTY: Text = {
  pl: "Warunki gwarancji PUDU dla klientów biznesowych. Robot jest objęty gwarancją 24 miesiące od daty wdrożenia, akumulator — 12 miesięcy. Gwarancja nie obejmuje uszkodzeń mechanicznych, zalania ani napraw wykonanych przez osoby nieautoryzowane. Zgłoszenie usterki należy wysłać e-mailem na adres serwis@example.pl; serwis odpowiada w ciągu 3 dni roboczych i w razie potrzeby umawia wizytę. Wymiana zużywalnych elementów, takich jak szczotki i filtry, jest płatna.",
  en: "PUDU warranty terms for business customers. The robot is covered for 24 months from the deployment date, the battery for 12 months. The warranty does not cover mechanical damage, water damage or repairs by unauthorized persons. Report a fault by e-mail to serwis@example.pl; the service team replies within 3 working days and arranges a visit if needed. Replacing consumables such as brushes and filters is chargeable.",
};

const CUSTOMER_MAIL: Text = {
  pl: "Od: Marta Kowalczyk. Temat: BellaBot znowu piszczy. W piątek był u nas technik i wymienił czujnik. Dziś rano robot znowu piszczy przy stoliku 4 i staje. W sobotę mamy wesele na 60 osób. Proszę o szczerą odpowiedź, czy robot będzie działał, bo wolałabym zamówić dodatkową obsługę. Nikt nie obiecał mi żadnej rekompensaty.",
  en: "From: Marta Kowalczyk. Subject: BellaBot beeping again. A technician was here on Friday and replaced a sensor. This morning the robot is beeping again at table 4 and stops. We have a wedding for 60 guests on Saturday. Please give me an honest answer on whether the robot will work, because I would rather book extra staff. Nobody has promised me any compensation.",
};

const BATTERY_STEPS: Text = {
  pl: "Procedura wymiany akumulatora w CC1. 1. Wyłącz robota i odłącz go od stacji. 2. Zdejmij pokrywę akumulatora (4 śruby). 3. Odłącz złącze akumulatora, dopiero potem wyjmij pakiet. 4. Włóż nowy pakiet, podłącz złącze i załóż pokrywę. 5. Włącz robota i wykonaj pełny cykl ładowania na stacji.",
  en: "Battery replacement procedure for the CC1. 1. Switch the robot off and disconnect it from the dock. 2. Remove the battery cover (4 screws). 3. Disconnect the battery connector, only then take out the pack. 4. Insert the new pack, connect the connector and refit the cover. 5. Switch the robot on and run a full charge cycle on the dock.",
};

const HOTEL_OFFER: Text = {
  pl: "Oferta pilotażowa dla hotelu Górski Dwór. Zakres: 1 robot BellaBot Pro na 3 miesiące w jednym obiekcie, obsługa room service w godzinach 20:00–6:00. Cena najmu: 2 900 zł netto miesięcznie. Integracja z windą Schindler wymaga wcześniejszej oceny technicznej i nie jest wliczona w cenę. Szkolenie personelu (2 godziny) jest wliczone. Oferta ważna do 31 października.",
  en: "Pilot offer for the Gorski Dwor hotel. Scope: 1 BellaBot Pro robot for 3 months at one property, room service between 20:00 and 06:00. Rental price: PLN 2,900 net per month. Integration with the Schindler lift needs a prior technical assessment and is not included in the price. Staff training (2 hours) is included. The offer is valid until 31 October.",
};

export const EXAMPLES: GroundingExample[] = [
  { id: "A", title: { pl: "Gwarancja · streszczenie z błędami", en: "Warranty · summary with errors" }, source: WARRANTY, answer: {
    pl: "Robot ma 24 miesiące gwarancji, a akumulator 12 miesięcy. Gwarancja obejmuje również zalanie robota. Serwis odpowiada na zgłoszenie w ciągu 3 dni roboczych. Szczotki i filtry wymieniamy bezpłatnie. Każdą naprawę wykonujemy u klienta w ciągu 24 godzin.",
    en: "The robot has a 24-month warranty and the battery 12 months. The warranty also covers water damage. The service team replies within 3 working days. We replace brushes and filters free of charge. Every repair is done on site within 24 hours.",
  } },
  { id: "B", title: { pl: "Gwarancja · wierne streszczenie", en: "Warranty · faithful summary" }, source: WARRANTY, answer: {
    pl: "Robot jest objęty gwarancją przez 24 miesiące, a akumulator przez 12 miesięcy. Gwarancja nie obejmuje zalania ani uszkodzeń mechanicznych. Usterkę zgłasza się mailem, a serwis odpowiada w ciągu 3 dni roboczych. Szczotki i filtry wymienia się odpłatnie.",
    en: "The robot is covered for 24 months and the battery for 12 months. The warranty does not cover water or mechanical damage. A fault is reported by e-mail and the service team replies within 3 working days. Brushes and filters are replaced for a fee.",
  } },
  { id: "C", title: { pl: "Mail klientki · dopisane obietnice", en: "Customer e-mail · invented claims" }, source: CUSTOMER_MAIL, answer: {
    pl: "Klientka zgłasza, że BellaBot piszczy przy stoliku 4 mimo piątkowej wymiany czujnika. W sobotę ma wesele na 60 osób. Klientka żąda rekompensaty 500 zł. Prosi o szczerą odpowiedź, czy robot będzie działał. Technik jest już w drodze.",
    en: "The customer reports that BellaBot beeps at table 4 despite the sensor replacement on Friday. She has a wedding for 60 guests on Saturday. She demands PLN 500 compensation. She asks for an honest answer on whether the robot will work. A technician is already on the way.",
  } },
  { id: "D", title: { pl: "Procedura akumulatora · zła kolejność", en: "Battery procedure · wrong order" }, source: BATTERY_STEPS, answer: {
    pl: "Najpierw wyłącz robota i odłącz go od stacji. Pokrywa akumulatora jest przykręcona czterema śrubami. Pakiet można wyjąć jeszcze przed odłączeniem złącza. Po montażu należy wykonać pełny cykl ładowania na stacji. Wymiana zajmuje około 5 minut.",
    en: "First switch the robot off and disconnect it from the dock. The battery cover is held by four screws. The pack can be taken out before disconnecting the connector. After fitting, run a full charge cycle on the dock. The replacement takes about 5 minutes.",
  } },
  { id: "E", title: { pl: "Oferta hotelowa · liczby", en: "Hotel offer · numbers" }, source: HOTEL_OFFER, answer: {
    pl: "Oferta obejmuje jednego robota BellaBot Pro na 3 miesiące. Najem kosztuje 2 900 zł netto miesięcznie. Integracja z windą jest wliczona w cenę. Szkolenie personelu trwa 2 godziny. Oferta jest ważna do końca listopada.",
    en: "The offer covers one BellaBot Pro robot for 3 months. Rental costs PLN 2,900 net per month. Lift integration is included in the price. Staff training takes 2 hours. The offer is valid until the end of November.",
  } },
];
