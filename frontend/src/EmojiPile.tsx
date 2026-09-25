import { type RefObject, useEffect, useRef } from "react";
import { LIFT_SCALE, World } from "./physics";

export type PileItem = {
  id: string;
  emoji: string;
  label: string;
};

export type LiftedItem = {
  id: string;
  score: number;
};

type EmojiPileProps = {
  items: PileItem[];
  lifted: LiftedItem[];
  anchorRef: RefObject<HTMLElement | null>;
};

const ROW_GAP_PX = 28;
const SLOT_MIN_WIDTH_PX = 92;
const SIDE_GUTTER_PX = 16;

/** Lays lifted emoji out in centred rows just below the anchor element. */
function rowTargets(world: World, count: number, anchorBottom: number) {
  const liftedRadius = world.radius * LIFT_SCALE;
  const slotWidth = Math.max(SLOT_MIN_WIDTH_PX, liftedRadius * 2 + 24);
  const perRow = Math.max(
    1,
    Math.floor((world.width - SIDE_GUTTER_PX * 2) / slotWidth),
  );
  const rowHeight = liftedRadius * 2 + ROW_GAP_PX + 18;
  const firstRowY = anchorBottom + ROW_GAP_PX + liftedRadius;

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const column = index % perRow;
    return {
      x: world.width / 2 + (column - (inRow - 1) / 2) * slotWidth,
      y: firstRowY + row * rowHeight,
    };
  });
}

export function EmojiPile({ items, lifted, anchorRef }: EmojiPileProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const worldRef = useRef<World | null>(null);
  const liftedRef = useRef(lifted);
  liftedRef.current = lifted;

  const indexById = useRef(new Map<string, number>());
  indexById.current = new Map(items.map((item, index) => [item.id, index]));

  /** Sends the current selection to the world: lift matches, drop the rest. */
  function syncLift(world: World) {
    const selection = liftedRef.current;
    const anchorBottom = anchorRef.current?.getBoundingClientRect().bottom ?? 0;
    const targets = rowTargets(world, selection.length, anchorBottom);
    const liftedIndexes = new Set<number>();

    selection.forEach((item, order) => {
      const index = indexById.current.get(item.id);
      if (index === undefined) return;
      liftedIndexes.add(index);
      world.lift(index, targets[order].x, targets[order].y);
    });

    world.bodies.forEach((_, index) => {
      if (!liftedIndexes.has(index)) world.release(index);
    });
  }

  useEffect(() => {
    const field = fieldRef.current;
    if (!field || !items.length) return;

    const world = new World(items.length, field.clientWidth, field.clientHeight);
    worldRef.current = world;
    const rendered = world.bodies.map(() => ({
      x: NaN,
      y: NaN,
      angle: NaN,
      scale: NaN,
    }));

    const observer = new ResizeObserver(() => {
      world.resize(field.clientWidth, field.clientHeight);
      rendered.forEach((shown) => (shown.x = NaN));
      field.style.setProperty("--body-size", `${world.radius * 2}px`);
      syncLift(world);
    });
    observer.observe(field);
    field.style.setProperty("--body-size", `${world.radius * 2}px`);
    syncLift(world);

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      world.advance((now - last) / 1000);
      last = now;

      world.bodies.forEach((body, index) => {
        const node = nodeRefs.current[index];
        const shown = rendered[index];
        // Sleeping emoji do not move, so skip their DOM writes entirely.
        if (
          !node ||
          (Math.abs(shown.x - body.x) < 0.05 &&
            Math.abs(shown.y - body.y) < 0.05 &&
            Math.abs(shown.angle - body.angle) < 0.002 &&
            Math.abs(shown.scale - body.scale) < 0.002)
        ) {
          return;
        }
        shown.x = body.x;
        shown.y = body.y;
        shown.angle = body.angle;
        shown.scale = body.scale;
        node.style.transform =
          `translate3d(${(body.x - body.r).toFixed(2)}px, ` +
          `${(body.y - body.r).toFixed(2)}px, 0) ` +
          `scale(${body.scale.toFixed(3)}) rotate(${body.angle.toFixed(3)}rad)`;
      });

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      worldRef.current = null;
    };
  }, [items]);

  useEffect(() => {
    if (worldRef.current) syncLift(worldRef.current);
  }, [lifted, items]);

  const scoreById = new Map(lifted.map((item) => [item.id, item.score]));

  return (
    <div className="emoji-field" ref={fieldRef} aria-hidden="true">
      {items.map((item, index) => {
        const score = scoreById.get(item.id);
        return (
          <span
            className={`emoji-body ${score === undefined ? "" : "is-lifted"}`}
            key={item.id}
            ref={(node) => {
              nodeRefs.current[index] = node;
            }}
          >
            <span className="emoji-glyph">{item.emoji}</span>
            <span className="emoji-caption">
              {item.label}
              {score !== undefined && <strong>{Math.round(score * 100)}%</strong>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
