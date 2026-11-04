import { $, html, raw, debounce } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout } from '../core/layout.js';

initLayout();

const wrap = $('[data-faq-groups]');
let items = [];

function render(q = '') {
  const needle = q.trim().toLowerCase();
  const list = needle ? items.filter((f) => `${f.question} ${f.answer}`.toLowerCase().includes(needle)) : items;
  if (!list.length) {
    wrap.innerHTML = '<p class="helper-note">No matches. Try another word, or ask June directly below.</p>';
    return;
  }
  const groups = new Map();
  list.forEach((f) => {
    const g = f.group || 'General';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  });
  wrap.innerHTML = [...groups].map(([g, fs]) => html`
    <section class="faq-group" style="padding:20px 0;content-visibility:visible">
      <h2 style="font-size:1.2rem;margin-bottom:12px">${g}</h2>
      <div class="faq-list">${fs.map((f) => raw(html`<details class="faq-item" ${needle ? 'open' : ''}><summary>${f.question}</summary><div class="answer">${f.answer}</div></details>`))}</div>
    </section>`).join('');
}

(async () => {
  ({ items } = await get('/faqs'));
  render();
  $('[data-faq-search]').addEventListener('input', debounce((e) => render(e.target.value), 150));
})();
