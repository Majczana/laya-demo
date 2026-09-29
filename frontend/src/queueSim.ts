/**
 * Live dispatch queue: tickets arrive on their own clock, a model triages them one at a time
 * (priority and team), and technicians pick them up from priority lanes.
 *
 * The clock never waits for the model, so a slow model lets the inbox grow, and a wrong answer
 * has a price: a P1 filed as P3 waits in the wrong lane and breaches its response time, and a
 * ticket sent to the wrong team is picked up, found misrouted and sent back. The simulation has
 * no DOM and no network; the caller advances time with `tick` and hands model answers to
 * `completeTriage`. Imports end in `.ts` so Node can run it directly.
 */
import { TICKETS, type Department, type Priority, type QueueTicket } from "./queueTickets.ts";

export type Dept = Department | "triage";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

/** Demo milliseconds of technician work per true priority. */
export const HANDLE_MS: Record<Priority, number> = { P1: 9000, P2: 7000, P3: 5000, P4: 3000 };
/** A misrouted ticket is recognised and sent back after this long. */
export const REROUTE_MS = 2500;
/** Time from arrival to a technician taking the ticket; by the true priority, not the model's. */
export const SLA_MS: Record<Priority, number | null> = { P1: 8000, P2: 20000, P3: 45000, P4: null };

export type TechKind = "field" | "remote" | "office";
const TECH_FOR: Record<Dept, TechKind> = {
  field_service: "field", remote_support: "remote", customer_service: "office", contracts: "office", triage: "office",
};
export const TEAM: { id: string; kind: TechKind }[] = [
  { id: "field-1", kind: "field" }, { id: "field-2", kind: "field" }, { id: "remote-1", kind: "remote" }, { id: "office-1", kind: "office" },
];

export type Settings = {
  /** Mean time between arriving tickets. */
  arrivalMs: number;
};

export type SimTicket = {
  key: number;
  ticket: QueueTicket;
  arrivedAt: number;
  triageStartedAt: number | null;
  triagedAt: number | null;
  modelMs: number | null;
  /** What the model answered. */
  priority: Priority | null;
  department: Dept | null;
  review: boolean;
  /** Where the ticket is routed now; changes after a misrouting is corrected. */
  route: Dept | null;
  reroutes: number;
  assignedAt: number | null;
  doneAt: number | null;
  breached: boolean;
};

export type Tech = { id: string; kind: TechKind; ticket: SimTicket | null; left: number; total: number; rework: boolean; done: number };

export type Sim = {
  settings: Settings;
  random: () => number;
  clock: number;
  nextArrivalAt: number;
  seq: number;
  bag: number[];
  inbox: SimTicket[];
  triaging: SimTicket | null;
  lanes: Record<Priority, SimTicket[]>;
  techs: Tech[];
  done: SimTicket[];
  /** Every triaged ticket, newest first (capped). */
  log: SimTicket[];
  arrived: number;
  version: number;
  history: { t: number; inbox: number; waiting: number }[];
  lastSample: number;
};

const MAX_LOG = 200;
const MAX_DONE = 60;
const MAX_HISTORY = 120;

export function createSim(settings: Settings, random: () => number = Math.random): Sim {
  const sim: Sim = {
    settings, random, clock: 0, nextArrivalAt: 600, seq: 0, bag: [], inbox: [], triaging: null,
    lanes: { P1: [], P2: [], P3: [], P4: [] },
    techs: TEAM.map(({ id, kind }) => ({ id, kind, ticket: null, left: 0, total: 0, rework: false, done: 0 })),
    done: [], log: [], arrived: 0, version: 0, history: [], lastSample: 0,
  };
  return sim;
}

function nextFromBag(sim: Sim): QueueTicket {
  if (sim.bag.length === 0) {
    const order = TICKETS.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(sim.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    sim.bag = order;
  }
  return TICKETS[sim.bag.pop()!];
}

/** Put `count` new tickets into the inbox at once. */
export function arrive(sim: Sim, count = 1): void {
  for (let n = 0; n < count; n++) {
    sim.inbox.push({
      key: ++sim.seq, ticket: nextFromBag(sim), arrivedAt: sim.clock, triageStartedAt: null, triagedAt: null, modelMs: null,
      priority: null, department: null, review: false, route: null, reroutes: 0, assignedAt: null, doneAt: null, breached: false,
    });
    sim.arrived++;
  }
  sim.version++;
}

function slaOf(t: SimTicket): number | null {
  return SLA_MS[t.ticket.priority];
}

function pickFor(sim: Sim, tech: Tech): SimTicket | null {
  for (const priority of PRIORITIES) {
    const lane = sim.lanes[priority];
    const index = lane.findIndex((t) => t.route !== null && TECH_FOR[t.route] === tech.kind);
    if (index >= 0) return lane.splice(index, 1)[0];
  }
  return null;
}

function finish(sim: Sim, tech: Tech): void {
  const t = tech.ticket!;
  tech.ticket = null;
  tech.left = 0;
  if (tech.rework) {
    // Found on the wrong team: send it back to the right one, at the same lane.
    t.route = t.ticket.department;
    t.reroutes++;
    sim.lanes[t.priority!].push(t);
  } else {
    t.doneAt = sim.clock;
    tech.done++;
    sim.done.unshift(t);
    if (sim.done.length > MAX_DONE) sim.done.pop();
  }
  tech.rework = false;
  sim.version++;
}

const STEP_MS = 50;

/** Advance the clock: tickets arrive, technicians work and pick up the next ticket by lane order. */
export function tick(sim: Sim, dtMs: number): void {
  // Small steps keep the order of events the same whether the caller ticks by 16 ms or by 10 s.
  for (let left = dtMs; left > 0; left -= STEP_MS) step(sim, Math.min(STEP_MS, left));
}

function step(sim: Sim, dtMs: number): void {
  sim.clock += dtMs;
  while (sim.clock >= sim.nextArrivalAt) {
    arrive(sim);
    sim.nextArrivalAt += sim.settings.arrivalMs * (0.6 + 0.8 * sim.random());
  }
  for (const tech of sim.techs) {
    if (tech.ticket) {
      tech.left -= dtMs;
      if (tech.left <= 0) finish(sim, tech);
    }
    if (!tech.ticket) {
      const t = pickFor(sim, tech);
      if (t) {
        tech.ticket = t;
        tech.rework = t.route !== t.ticket.department;
        tech.total = tech.left = tech.rework ? REROUTE_MS : HANDLE_MS[t.ticket.priority];
        if (t.assignedAt === null) {
          t.assignedAt = sim.clock;
          const limit = slaOf(t);
          t.breached = limit !== null && sim.clock - t.arrivedAt > limit;
        }
        sim.version++;
      }
    }
  }
  if (sim.clock - sim.lastSample >= 1000) {
    sim.lastSample = sim.clock;
    const waiting = PRIORITIES.reduce((sum, priority) => sum + sim.lanes[priority].length, 0);
    sim.history.push({ t: sim.clock, inbox: sim.inbox.length + (sim.triaging ? 1 : 0), waiting });
    if (sim.history.length > MAX_HISTORY) sim.history.shift();
  }
}

/** Take the oldest inbox ticket for the model; null when there is none or one is already being triaged. */
export function beginTriage(sim: Sim): SimTicket | null {
  if (sim.triaging || sim.inbox.length === 0) return null;
  const t = sim.inbox.shift()!;
  t.triageStartedAt = sim.clock;
  sim.triaging = t;
  sim.version++;
  return t;
}

export function completeTriage(sim: Sim, key: number, answer: { priority: Priority; department: Dept; modelMs: number; review: boolean }): boolean {
  const t = sim.triaging;
  if (!t || t.key !== key) return false;
  t.priority = answer.priority;
  t.department = answer.department;
  t.route = answer.department;
  t.modelMs = answer.modelMs;
  t.review = answer.review;
  t.triagedAt = sim.clock;
  sim.lanes[answer.priority].push(t);
  sim.log.unshift(t);
  if (sim.log.length > MAX_LOG) sim.log.pop();
  sim.triaging = null;
  sim.version++;
  return true;
}

/** The model failed: return the ticket to the front of the inbox. */
export function abortTriage(sim: Sim, key: number): void {
  const t = sim.triaging;
  if (!t || t.key !== key) return;
  t.triageStartedAt = null;
  sim.inbox.unshift(t);
  sim.triaging = null;
  sim.version++;
}

export type Summary = {
  arrived: number;
  triaged: number;
  inbox: number;
  waiting: number;
  done: number;
  priorityHits: number;
  departmentHits: number;
  avgModelMs: number | null;
  /** Average time a ticket waited in the inbox before the model took it, in ms. */
  avgInboxWaitMs: number | null;
  p1AssignMs: number | null;
  breaches: number;
  reroutes: number;
};

export function summarize(sim: Sim): Summary {
  const triaged = sim.log;
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const everyTicket = [...triaged, ...sim.inbox, ...(sim.triaging ? [sim.triaging] : [])];
  const overdue = (t: SimTicket) => {
    const limit = slaOf(t);
    if (limit === null) return false;
    return t.assignedAt === null ? sim.clock - t.arrivedAt > limit : t.breached;
  };
  return {
    arrived: sim.arrived,
    triaged: triaged.length,
    inbox: sim.inbox.length + (sim.triaging ? 1 : 0),
    waiting: PRIORITIES.reduce((sum, priority) => sum + sim.lanes[priority].length, 0),
    done: sim.techs.reduce((sum, tech) => sum + tech.done, 0),
    priorityHits: triaged.filter((t) => t.priority === t.ticket.priority).length,
    departmentHits: triaged.filter((t) => t.department === t.ticket.department).length,
    avgModelMs: mean(triaged.map((t) => t.modelMs).filter((v): v is number => v !== null)),
    avgInboxWaitMs: mean(triaged.map((t) => t.triageStartedAt! - t.arrivedAt)),
    p1AssignMs: mean(triaged.filter((t) => t.ticket.priority === "P1" && t.assignedAt !== null).map((t) => t.assignedAt! - t.arrivedAt)),
    breaches: everyTicket.filter(overdue).length,
    reroutes: triaged.reduce((sum, t) => sum + t.reroutes, 0),
  };
}
