// ⤒ / ⤓ buttons. args.to: 'top' | 'bottom'.
(args) => {
  const scroller = document.scrollingElement || document.documentElement;
  const top = args && args.to === 'bottom' ? scroller.scrollHeight : 0;
  scroller.scrollTo({ top, behavior: 'smooth' });
  return true;
}
