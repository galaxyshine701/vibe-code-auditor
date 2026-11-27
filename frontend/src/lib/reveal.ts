// The reveal on scroll: a card (its outer wrapper, `data-reveal`) comes up 28px
// and fades in, once, when it comes into view. The glass with its backdrop blur
// is a still layer inside that wrapper.
//
// The wrapper carries `data-reveal-state`: "wait" (hidden, below its place),
// "run" (the animation of glass.css; will-change only here) and "done" (no style
// at all). Without a script no wrapper ever gets a state, so everything is there
// from the start; with reduced motion, or with no IntersectionObserver, the same.
//
// A group (`data-reveal-group`, else the parent) is staggered a little. Its
// heading (`data-reveal="head"`) does not come on its own: it rises with the
// first card of its group.

export const REVEAL = {
  /** this much of a card, or of the screen for a very tall card, must be in */
  threshold: 0.15,
  /** a little inside the bottom of the screen */
  rootMargin: '0px 0px -8% 0px',
  durationMs: 650,
  staggerMs: 90,
  maxDelayMs: 450,
  /** if the page's own code never takes over, the boot script shows all */
  bootFallbackMs: 4000,
} as const;

/** The delay of the card at this place of its batch. */
export function delayOf(place: number): number {
  return Math.min(Math.max(0, place) * REVEAL.staggerMs, REVEAL.maxDelayMs);
}

/**
 * The inline script of the <head>: it hides the wrappers before the first paint,
 * so that what is on the first screen can rise once without a flash. If the
 * page's code does not take over in time, everything is shown.
 */
export const REVEAL_BOOT_SCRIPT = `(function(){try{if(!window.IntersectionObserver||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;var d=document.documentElement;d.setAttribute('data-reveal-boot','');setTimeout(function(){if(!window.__vcaRevealOwned)d.removeAttribute('data-reveal-boot');},${REVEAL.bootFallbackMs});}catch(e){}})();`;

const INTRO_RUNNING = ['pending', 'opening'];

/** Starts the reveal for everything under `body`, now and later. Returns the stop. */
export function startReveal(body: HTMLElement): () => void {
  const root = document.documentElement;
  const waiting = new Set<HTMLElement>();
  const timers = new Set<number>();
  let watch: IntersectionObserver | null = null;

  const isHead = (node: HTMLElement) => node.dataset.reveal === 'head';
  const groupOf = (node: HTMLElement): Element =>
    node.closest('[data-reveal-group]') ?? node.parentElement ?? body;

  const finish = (node: HTMLElement) => {
    node.dataset.revealState = 'done';
    node.style.removeProperty('--reveal-delay');
  };

  const take = (node: HTMLElement) => {
    waiting.delete(node);
    watch?.unobserve(node);
  };

  const run = (node: HTMLElement, delay: number) => {
    take(node);
    node.style.setProperty('--reveal-delay', `${delay}ms`);
    node.dataset.revealState = 'run';
    const end = (event?: Event) => {
      if (event && event.target !== node) return;
      node.removeEventListener('animationend', end);
      window.clearTimeout(timer);
      timers.delete(timer);
      finish(node);
    };
    node.addEventListener('animationend', end);
    // in case the end is never told (a hidden tab, a node taken out)
    const timer = window.setTimeout(end, delay + REVEAL.durationMs + 300);
    timers.add(timer);
  };

  /** These cards are in view: each group staggers its own, with its heading. */
  const show = (nodes: HTMLElement[]) => {
    const groups = new Map<Element, HTMLElement[]>();
    for (const node of nodes) {
      const group = groupOf(node);
      const all = [...waiting].filter((other) => groupOf(other) === group);
      // a heading waits for a card of its group, if there is one to wait for
      if (isHead(node) && all.some((other) => !isHead(other) && other.childElementCount)) {
        continue;
      }
      groups.set(group, [...(groups.get(group) ?? []), node]);
    }
    for (const [group, found] of groups) {
      const heads = [...waiting].filter(
        (node) => isHead(node) && groupOf(node) === group,
      );
      const cards = found
        .filter((node) => !isHead(node))
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
      heads.forEach((node) => run(node, 0));
      cards.forEach((node, place) => run(node, delayOf(place)));
    }
  };

  const scan = () => {
    if (!watch) return;
    body
      .querySelectorAll<HTMLElement>('[data-reveal]:not([data-reveal-state])')
      .forEach((node) => {
        node.dataset.revealState = 'wait';
        waiting.add(node);
        watch!.observe(node);
      });
  };

  const observe = () => {
    watch = new IntersectionObserver(
      (entries) => {
        show(
          entries
            .filter((entry) => {
              const screen = entry.rootBounds?.height ?? window.innerHeight;
              return (
                entry.isIntersecting &&
                (entry.intersectionRatio >= REVEAL.threshold - 0.001 ||
                  entry.intersectionRect.height >= screen * REVEAL.threshold)
              );
            })
            .map((entry) => entry.target as HTMLElement)
            .filter((node) => waiting.has(node)),
        );
      },
      {
        rootMargin: REVEAL.rootMargin,
        // steps of 1%, so a card taller than the screen is told in time too
        threshold: Array.from({ length: 16 }, (_, i) => i / 100),
      },
    );
    waiting.forEach((node) => watch!.observe(node));
    scan();
  };

  // at the end of the page nothing can be scrolled further in
  const atEnd = () => {
    if (window.innerHeight + window.scrollY < root.scrollHeight - 2) return;
    show(
      [...waiting].filter((node) => {
        const box = node.getBoundingClientRect();
        return box.height > 0 && box.top < window.innerHeight;
      }),
    );
  };

  // what the keyboard reaches is shown at once
  const focused = (event: FocusEvent) => {
    let node = (event.target as Element | null)?.closest<HTMLElement>('[data-reveal]');
    while (node) {
      take(node);
      finish(node);
      node = node.parentElement?.closest<HTMLElement>('[data-reveal]') ?? null;
    }
  };

  // hidden at once; the watching starts when the intro is not over the page
  body.querySelectorAll<HTMLElement>('[data-reveal]').forEach((node) => {
    node.dataset.revealState = 'wait';
    waiting.add(node);
  });
  const later = new MutationObserver(() => {
    if (watch) return scan();
    body
      .querySelectorAll<HTMLElement>('[data-reveal]:not([data-reveal-state])')
      .forEach((node) => {
        node.dataset.revealState = 'wait';
        waiting.add(node);
      });
  });
  later.observe(body, { childList: true, subtree: true });
  const intro = new MutationObserver(() => {
    if (INTRO_RUNNING.includes(root.dataset.intro ?? '')) return;
    intro.disconnect();
    if (!watch) observe();
  });
  if (INTRO_RUNNING.includes(root.dataset.intro ?? '')) {
    intro.observe(root, { attributes: true, attributeFilter: ['data-intro'] });
  } else {
    observe();
  }
  window.addEventListener('scroll', atEnd, { passive: true });
  document.addEventListener('focusin', focused);

  return () => {
    watch?.disconnect();
    later.disconnect();
    intro.disconnect();
    window.removeEventListener('scroll', atEnd);
    document.removeEventListener('focusin', focused);
    timers.forEach((timer) => window.clearTimeout(timer));
    body.querySelectorAll<HTMLElement>('[data-reveal-state]').forEach(finish);
  };
}
