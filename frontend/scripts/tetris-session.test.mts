/**
 * Rules of the real-time Tetris session: the clock never waits for the model, a late answer is
 * not rescued by teleporting the piece, and gravity keeps speeding up. No backend needed.
 *
 *   node --test --experimental-strip-types frontend/scripts/tetris-session.test.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { newGame } from "../src/tetrisEngine.ts";
import {
  DEFAULT_SETTINGS,
  createSession,
  gravityFor,
  receive,
  summarize,
  takeRequest,
  tick,
  type ModelRequest,
  type Session,
  type Settings,
} from "../src/tetrisSession.ts";

let seed = 7;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const SLOW: Settings = { ...DEFAULT_SETTINGS, gravityMs: 40, rampEvery: 0, lockDelayMs: 400 };

function fresh(settings: Settings = SLOW): Session {
  seed = 7;
  return createSession(settings, newGame());
}

function answer(session: Session, request: ModelRequest, chosen = 0): boolean {
  return receive(session, request.serial, {
    candidates: request.candidates, chosen, scores: request.candidates.map(() => 0.5), descriptions: null, modelMs: 10,
  });
}

test("a piece locks by itself when the model never answers", () => {
  const session = fresh();
  takeRequest(session);
  tick(session, 5000);
  assert.ok(session.reports.length > 0);
  assert.equal(session.reports[0].outcome, "unanswered");
  assert.equal(session.reports[0].answerMs, null);
});

test("without answers the pieces pile up in the middle and the game ends", () => {
  const session = fresh();
  for (let steps = 0; steps < 400 && session.game.status === "playing"; steps++) {
    takeRequest(session);
    tick(session, 500);
  }
  assert.equal(session.game.status, "over");
  assert.ok(session.reports.every((report) => report.outcome === "unanswered"));
  const columns = new Set<number>();
  session.game.board.forEach((row) => row.forEach((cell, x) => { if (cell) columns.add(x); }));
  assert.ok(columns.size <= 6, `pieces spread over ${columns.size} columns instead of stacking`);
});

test("an answer in time steers the piece exactly to the chosen landing", () => {
  const session = fresh({ ...SLOW, gravityMs: 600 });
  const request = takeRequest(session)!;
  const chosen = request.candidates.findIndex((candidate) => candidate.x !== session.game.active.x);
  assert.ok(answer(session, request, Math.max(0, chosen)));
  tick(session, 6000);
  assert.equal(session.reports[0].outcome, "on-target");
  assert.ok(session.reports[0].answerMs !== null && session.reports[0].answerMs < 50);
});

test("an answer after the piece locked is dropped, not applied to the next piece", () => {
  const session = fresh();
  const request = takeRequest(session)!;
  tick(session, 5000);
  assert.ok(session.reports.length > 0);
  const serialNow = session.game.pieceSerial;
  assert.equal(answer(session, request), false);
  assert.equal(session.lateAnswers, 1);
  assert.equal(session.game.pieceSerial, serialNow);
  assert.equal(session.choice, null);
});

test("an answer that comes too late does not teleport the piece to the target", () => {
  const session = fresh();
  const request = takeRequest(session)!;
  // Free fall to the floor takes ~18 rows × 40 ms, then the lock delay: answer with ~40 ms to spare.
  const floorAt = 40 * 17;
  tick(session, floorAt + SLOW.lockDelayMs - 40);
  const far = request.candidates.reduce((best, candidate, index) => (
    Math.abs(candidate.x - session.game.active.x) + candidate.rotation > Math.abs(request.candidates[best].x - session.game.active.x) + request.candidates[best].rotation ? index : best
  ), 0);
  assert.ok(answer(session, request, far));
  tick(session, 2000);
  assert.equal(session.reports[0].outcome, "off-target");
  assert.ok(session.game.board.flat().filter(Boolean).length >= 4, "the piece still locked on the board");
});

test("gravity speeds up with placed pieces and stops at the minimum", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, gravityMs: 600, rampEvery: 5, rampFactor: 0.5, minGravityMs: 100 };
  assert.equal(gravityFor(settings, 0), 600);
  assert.equal(gravityFor(settings, 4), 600);
  assert.equal(gravityFor(settings, 5), 300);
  assert.equal(gravityFor(settings, 10), 150);
  assert.equal(gravityFor(settings, 100), 100);
  assert.equal(gravityFor({ ...settings, rampEvery: 0 }, 100), 600);
});

test("summarize counts outcomes and answer times", () => {
  const session = fresh({ ...SLOW, gravityMs: 600 });
  for (let pieces = 0; pieces < 3; pieces++) {
    const request = takeRequest(session);
    if (request) answer(session, request);
    tick(session, 8000, true);
  }
  const summary = summarize(session.reports);
  assert.equal(summary.pieces, session.reports.length);
  assert.equal(summary.onTarget + summary.offTarget + summary.unanswered, summary.pieces);
  assert.ok(summary.avgAnswerMs !== null);
});
