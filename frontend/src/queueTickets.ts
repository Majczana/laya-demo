/** Incoming service tickets for the live dispatch queue, with the priority and team a person would choose. */

type Lang = "pl" | "en";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type Department = "field_service" | "remote_support" | "customer_service" | "contracts";
export type QueueTicket = { id: string; text: Record<Lang, string>; priority: Priority; department: Department };

export const TICKETS: QueueTicket[] = [
  { id: "T01", priority: "P1", department: "field_service", text: {
    pl: "BellaBot przy stoliku dziecięcym nagle przyspieszył i uderzył w krzesło, dziecko jest przestraszone. Wyłączyliśmy robota i zablokowaliśmy go w magazynie.",
    en: "BellaBot suddenly sped up at the children's table and hit a chair, and a child is frightened. We powered it off and locked it away in the storeroom." } },
  { id: "T02", priority: "P1", department: "field_service", text: {
    pl: "MT1 dymi podczas ładowania i czuć spalenizną. Odłączyliśmy zasilanie i wyprowadziliśmy ludzi z sali.",
    en: "The MT1 is smoking while charging and there is a burning smell. We cut the power and cleared people out of the hall." } },
  { id: "T03", priority: "P1", department: "field_service", text: {
    pl: "Stacja ładująca iskrzy, gdy podłączamy robota. Wyłączyliśmy bezpiecznik i nie dotykamy jej.",
    en: "The charging dock sparks when we plug the robot in. We switched off the fuse and are not touching it." } },
  { id: "T04", priority: "P2", department: "field_service", text: {
    pl: "Robot nie rusza ze stacji od rana, ekran pokazuje błąd silnika. Na dziś mamy 80 gości i nikogo do noszenia tac.",
    en: "The robot has not left its dock since morning and the screen shows a motor error. We have 80 guests today and nobody to carry trays." } },
  { id: "T05", priority: "P2", department: "field_service", text: {
    pl: "CC1 nie podaje wody, a halę musimy umyć przed jutrzejszym otwarciem o 7:00. Mamy tylko jednego robota.",
    en: "The CC1 does not dispense water and we must clean the hall before opening at 7:00 tomorrow. We only have this one robot." } },
  { id: "T06", priority: "P2", department: "field_service", text: {
    pl: "T300 w magazynie zatrzymuje się co kilka metrów, bo czujnik krawędzi zgłasza błąd. Cała linia pakowania stoi.",
    en: "The T300 in the warehouse stops every few metres because the edge sensor reports an error. The whole packing line is at a standstill." } },
  { id: "T07", priority: "P2", department: "remote_support", text: {
    pl: "Po aktualizacji robot nie łączy się z Wi-Fi i nie przyjmuje zamówień z panelu. Kelnerzy stoją.",
    en: "After the update the robot does not connect to Wi-Fi and takes no orders from the panel. The waiters are idle." } },
  { id: "T08", priority: "P2", department: "remote_support", text: {
    pl: "Robot restartuje się co 10 minut i nie da się na nim pracować w godzinach szczytu.",
    en: "The robot restarts every 10 minutes and cannot be used during the lunch rush." } },
  { id: "T09", priority: "P3", department: "remote_support", text: {
    pl: "Robot gubi trasę po przestawieniu mebli, ale da się go prowadzić ręcznie z aplikacji. Czy można poprawić mapę zdalnie?",
    en: "The robot loses its route after furniture was moved, but we can guide it manually from the app. Can the map be fixed remotely?" } },
  { id: "T10", priority: "P3", department: "field_service", text: {
    pl: "Z prawej strony robota piszczy koło. Jeździ, ale wolniej niż zwykle.",
    en: "A wheel on the robot's right side squeaks. It still drives, but slower than usual." } },
  { id: "T11", priority: "P3", department: "remote_support", text: {
    pl: "Ekran czasem miga, po restarcie działa normalnie. Zdarza się kilka razy dziennie.",
    en: "The screen flickers now and then and works normally after a restart. It happens a few times a day." } },
  { id: "T12", priority: "P3", department: "field_service", text: {
    pl: "Taca w robocie pękła z boku, ale nadal można z niej korzystać. Prosimy o wymianę przy okazji.",
    en: "A tray on the robot cracked at the side but is still usable. Please replace it when convenient." } },
  { id: "T13", priority: "P3", department: "remote_support", text: {
    pl: "Nie możemy dodać nowej mapy w aplikacji, stara działa poprawnie.",
    en: "We cannot add a new map in the app; the old one works fine." } },
  { id: "T14", priority: "P4", department: "contracts", text: {
    pl: "Proszę o fakturę proforma na przedłużenie umowy serwisowej o 12 miesięcy.",
    en: "Please send a pro-forma invoice for extending the service contract by 12 months." } },
  { id: "T15", priority: "P4", department: "contracts", text: {
    pl: "Czy gwarancja obejmuje wymianę akumulatora po 20 miesiącach od wdrożenia?",
    en: "Does the warranty cover a battery replacement 20 months after deployment?" } },
  { id: "T16", priority: "P4", department: "customer_service", text: {
    pl: "Chcielibyśmy zamówić szkolenie dla nowych kelnerów w przyszłym miesiącu. Jakie są terminy?",
    en: "We would like to book training for our new waiters next month. Which dates are available?" } },
  { id: "T17", priority: "P4", department: "customer_service", text: {
    pl: "Dziękujemy za wczorajszą wizytę technika, wszystko działa. Prosimy o zamknięcie zgłoszenia.",
    en: "Thank you for the technician's visit yesterday; everything works. Please close the ticket." } },
  { id: "T18", priority: "P4", department: "remote_support", text: {
    pl: "Jak zmienić głośność komunikatów robota? Nie znaleźliśmy tego w instrukcji.",
    en: "How do I change the volume of the robot's announcements? We could not find it in the manual." } },
];
