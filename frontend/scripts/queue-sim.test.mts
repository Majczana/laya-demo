/**
 * Rules of the live dispatch queue: the clock never waits for the model, lanes are served by
 * priority, a wrong priority breaches the true response time and a wrong team costs a detour.
 * No backend needed.
 *
 *   node --test --experimental-strip-types frontend/scripts/queue-sim.test.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HANDLE_MS, REROUTE_MS, SLA_MS, abortTriage, arrive, beginTriage, completeTriage, createSim, summarize, tick,
  type Dept, type Sim, type SimTicket,
} from "../src/queueSim.ts";
import type { Priority } from "../src/queueTickets.ts";

/** A huge arrival time means "no automatic arrivals": tests then add tickets by hand. */
function fresh(arrivalMs = 1000): Sim {
  const sim = createSim({ arrivalMs }, () => 0.5);
  if (arrivalMs >= 1e9) sim.nextArrivalAt = Infinity;
  return sim;
}

/** Take the next inbox ticket and file it as the model would. */
function triage(sim: Sim, priority?: Priority, department?: Dept): SimTicket {
  const t = beginTriage(sim)!;
  completeTriage(sim, t.key, { priority: priority ?? t.ticket.priority, department: department ?? t.ticket.department, modelMs: 100, review: false });
  return t;
}

test("tickets keep arriving while nothing is triaged, so the inbox grows", () => {
  const sim = fresh(1000);
  tick(sim, 10000);
  assert.ok(sim.inbox.length >= 8 && sim.inbox.length <= 11, `inbox ${sim.inbox.length}`);
  assert.equal(summarize(sim).arrived, sim.inbox.length);
});

test("only one ticket is triaged at a time and a failure returns it to the front", () => {
  const sim = fresh();
  arrive(sim, 3);
  const first = beginTriage(sim)!;
  assert.equal(beginTriage(sim), null);
  assert.equal(sim.inbox.length, 2);
  abortTriage(sim, first.key);
  assert.equal(sim.inbox[0].key, first.key);
  assert.equal(sim.triaging, null);
});

test("a stale answer for another ticket is ignored", () => {
  const sim = fresh();
  arrive(sim, 2);
  const t = beginTriage(sim)!;
  assert.equal(completeTriage(sim, t.key + 1, { priority: "P1", department: "field_service", modelMs: 1, review: false }), false);
  assert.equal(sim.triaging?.key, t.key);
});

test("a free technician takes the highest priority lane first, for their own team only", () => {
  const sim = fresh(1e9);
  arrive(sim, 6);
  const filed: SimTicket[] = [];
  for (let n = 0; n < 6; n++) filed.push(triage(sim, "P4", "field_service"));
  const urgent = filed[5];
  sim.lanes.P4.splice(sim.lanes.P4.indexOf(urgent), 1);
  urgent.priority = "P1";
  sim.lanes.P1.push(urgent);
  tick(sim, 1);
  const field = sim.techs.filter((tech) => tech.kind === "field");
  assert.equal(field[0].ticket, urgent);
  assert.notEqual(field[1].ticket, urgent);
  assert.equal(sim.techs.find((tech) => tech.kind === "remote")!.ticket, null);
});

test("a ticket sent to the wrong team is found out, returned and finished by the right one", () => {
  const sim = fresh(1e9);
  arrive(sim, 1);
  const t = sim.inbox[0];
  const wrong: Dept = t.ticket.department === "contracts" ? "field_service" : "contracts";
  triage(sim, t.ticket.priority, wrong);
  tick(sim, 1);
  const tech = sim.techs.find((item) => item.ticket === t)!;
  assert.ok(tech.rework, "picked up as a detour");
  tick(sim, REROUTE_MS + 50);
  assert.equal(t.reroutes, 1);
  assert.equal(t.route, t.ticket.department);
  assert.equal(t.doneAt, null);
  tick(sim, HANDLE_MS[t.ticket.priority] + 2000);
  assert.ok(t.doneAt !== null, "the right team finished it");
  assert.equal(summarize(sim).reroutes, 1);
});

test("a P1 filed as P3 breaches the true response time when the technicians are busy", () => {
  const sim = fresh(1e9);
  arrive(sim, 3);
  // Two long jobs keep both field technicians busy (a P1 job takes 9 s); the third ticket is a real P1.
  const [busyA, busyB, urgent] = sim.inbox;
  for (const t of [busyA, busyB, urgent]) t.ticket = { ...t.ticket, priority: "P1", department: "field_service" };
  triage(sim, "P3", "field_service");
  triage(sim, "P3", "field_service");
  tick(sim, 1);
  triage(sim, "P3", "field_service");
  tick(sim, SLA_MS.P1! + 500);
  assert.equal(urgent.assignedAt, null, "still waiting in the P3 lane behind the busy technicians");
  assert.equal(summarize(sim).breaches, 1, "overdue by its true priority, although the model filed it as P3");
});

test("accuracy and timing are summarised from what the model answered", () => {
  const sim = fresh(1e9);
  arrive(sim, 4);
  triage(sim);
  triage(sim, "P4", "contracts");
  triage(sim);
  const summary = summarize(sim);
  assert.equal(summary.triaged, 3);
  assert.equal(summary.inbox, 1);
  assert.ok(summary.priorityHits >= 2 && summary.priorityHits <= 3);
  assert.equal(summary.avgModelMs, 100);
});
