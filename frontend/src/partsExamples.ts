/** Fault descriptions for the parts demo; free of React so scripts can import it. */

type Lang = "pl" | "en";
export type Robot = "delivery" | "cleaning";
/** Parts a person would name as the likely culprit; used only to check the demo, never shown as truth. */
export type PartsExample = { id: string; robot: Robot; title: Record<Lang, string>; symptom: Record<Lang, string>; expected: string[] };

export const EXAMPLES: PartsExample[] = [
  { id: "A", robot: "delivery", expected: ["bumper", "lidar", "camera"], title: { pl: "Nie zatrzymuje się przed gośćmi", en: "Does not stop for guests" }, symptom: {
    pl: "Robot skręca w stronę gości i nie zatrzymuje się przed krzesłami. Dopiero gdy ktoś go złapie, piszczy i staje.",
    en: "The robot turns towards guests and does not stop before chairs. Only when someone grabs it does it beep and stop.",
  } },
  { id: "B", robot: "delivery", expected: ["charger", "battery"], title: { pl: "Nie ładuje się na stacji", en: "Will not charge at the dock" }, symptom: {
    pl: "Od wczoraj robot wraca na stację, ale się nie ładuje. Kontrolka na stacji nie świeci, a robot wyłącza się po kilku kursach.",
    en: "Since yesterday the robot returns to its dock but does not charge. The dock light stays off and the robot shuts down after a few runs.",
  } },
  { id: "C", robot: "cleaning", expected: ["pump", "filter"], title: { pl: "Sucha podłoga przy pełnym zbiorniku", en: "Dry floor with a full tank" }, symptom: {
    pl: "Podczas mycia podłoga zostaje sucha. Zbiornik jest pełny, szczotki się obracają, ale woda nie wypływa.",
    en: "During scrubbing the floor stays dry. The tank is full and the brushes turn, but no water comes out.",
  } },
  { id: "D", robot: "cleaning", expected: ["lidar", "camera"], title: { pl: "Gubi trasę po zmianie mebli", en: "Loses its route after new furniture" }, symptom: {
    pl: "Po przestawieniu mebli w holu robot jeździ w kółko przy ścianie i nie może znaleźć drogi do stacji, chociaż mapa jest zapisana.",
    en: "After the lobby furniture was moved the robot circles along a wall and cannot find its way to the dock, although the map is saved.",
  } },
  { id: "E", robot: "delivery", expected: ["wheel"], title: { pl: "Wibruje i piszczy przy skręcie", en: "Vibrates and squeaks in turns" }, symptom: {
    pl: "Robot jedzie wolniej niż zwykle, wibruje i piszczy z prawej strony przy każdym skręcie w prawo.",
    en: "The robot drives slower than usual, vibrates and squeaks on its right side at every right turn.",
  } },
  { id: "F", robot: "delivery", expected: ["screen"], title: { pl: "Ekran się zawiesza", en: "Screen freezes" }, symptom: {
    pl: "Po uruchomieniu ekran robota zawiesza się na logo, dotyk nie reaguje, a robot nie przyjmuje zamówień.",
    en: "After start-up the robot's screen freezes on the logo, touch does not respond and the robot accepts no orders.",
  } },
  { id: "G", robot: "delivery", expected: ["tray"], title: { pl: "Taca „pusta”, robot nie rusza", en: "Tray “empty”, robot will not go" }, symptom: {
    pl: "Po położeniu naczyń na środkowej tacy robot twierdzi, że taca jest pusta i nie rusza do stolika.",
    en: "After dishes are placed on the middle tray the robot claims the tray is empty and will not move to the table.",
  } },
  { id: "H", robot: "cleaning", expected: ["battery"], title: { pl: "Wyłącza się mimo naładowanej baterii", en: "Shuts down despite a charged battery" }, symptom: {
    pl: "Robot wyłącza się po 20 minutach mycia, choć wskaźnik baterii pokazywał jeszcze 80%. Po chwili na stacji włącza się normalnie.",
    en: "The robot switches off after 20 minutes of scrubbing although the battery indicator still showed 80%. A moment later on the dock it starts normally.",
  } },
];
