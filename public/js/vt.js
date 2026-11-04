// Page-to-page transitions are a progressive enhancement. When a page redirects while loading
// (e.g. /account → /login), the browser aborts the transition; swallow that so it isn't logged as an error.
['pageswap', 'pagereveal'].forEach((type) => window.addEventListener(type, (e) => {
  const vt = e.viewTransition;
  if (vt) [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p && p.catch(() => {}));
}));
