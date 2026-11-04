import { $, html } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { reveal } from '../core/ui.js';

initLayout();

(async () => {
  const about = await get('/about').catch(() => null);
  if (!about) return;
  $('[data-about="title"]').textContent = about.title;
  $('[data-about="intro"]').textContent = about.intro;
  $('[data-about="paragraphs"]').innerHTML = (about.paragraphs || []).map((p) => html`<p>${p}</p>`).join('');
  $('[data-about="promises"]').innerHTML = (about.promises || []).map((p, i) => html`
    <div class="promise reveal" style="--i:${i};"><span class="promise-dab" aria-hidden="true">${i + 1}</span><h3>${p.title}</h3><p>${p.body}</p></div>`).join('');
  reveal();
})();
