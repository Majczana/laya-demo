/** A card that flies from one element to another; resolves when it lands (or at once with reduced motion). */
export function fly(from: DOMRect, to: DOMRect, label: string, duration: number): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  return new Promise((resolve) => {
    const sheet = document.createElement("div");
    sheet.className = "dz-flyer";
    sheet.textContent = label;
    Object.assign(sheet.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    document.body.appendChild(sheet);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = Math.max(0.1, Math.min(1, to.width / from.width, to.height / from.height));
    const animation = sheet.animate([
      { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) rotate(-4deg) scale(${(1 + scale) / 1.7})`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: 0.7 },
    ], { duration, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "forwards" });
    let finished = false;
    const finish = () => { if (finished) return; finished = true; sheet.remove(); resolve(); };
    animation.onfinish = finish;
    animation.oncancel = finish;
  });
}
