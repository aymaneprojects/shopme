// Seasonal planting calendar (garden): four seasons with the months and three jobs to do.
const t = (en, fr) => ({ en, fr });
const task = (n, en, fr) => ({ id: `task_${n}`, type: 'text', label: t(`Job ${n}`, `Tâche ${n}`), default: t(en, fr) });
export default {
  id: 'planting-calendar',
  name: t('Planting calendar', 'Calendrier de plantation'),
  settings: [
    { id: 'eyebrow', type: 'text', label: t('Eyebrow', 'Sur-titre'), default: t('Season by season', 'Saison après saison') },
    { id: 'heading', type: 'text', label: t('Heading', 'Titre'), default: t('What to plant and when', 'Quoi planter et quand') },
    { id: 'color_scheme', type: 'color_scheme', label: t('Color scheme', 'Palette de couleurs') },
  ],
  blocks: [{
    type: 'season',
    name: t('Season', 'Saison'),
    settings: [
      { id: 'title', type: 'text', label: t('Season', 'Saison'), default: t('Spring', 'Printemps') },
      { id: 'months', type: 'text', label: t('Months', 'Mois'), default: t('March to May', 'De mars à mai') },
      { id: 'icon', type: 'select', label: t('Icon', 'Icône'), default: 'leaf', options: [{ value: 'leaf', label: t('Leaf', 'Feuille') }, { value: 'sun', label: t('Sun', 'Soleil') }, { value: 'drop', label: t('Drop', 'Goutte') }, { value: 'moon', label: t('Moon', 'Lune') }] },
      task(1, 'Sow seeds indoors', 'Semer à l’intérieur'), task(2, 'Repot houseplants', 'Rempoter les plantes d’intérieur'), task(3, 'Prune climbers', 'Tailler les grimpantes'),
      { id: 'link', type: 'url', label: t('Link', 'Lien') },
    ],
  }],
  max_blocks: 4,
  presets: [{ name: t('Planting calendar', 'Calendrier de plantation'), blocks: [{ type: 'season' }, { type: 'season' }, { type: 'season' }, { type: 'season' }] }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-cal {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-section__head k-section__head--center">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
    </div>
    <ol class="k-cal__list" role="list">
      {%- for block in section.blocks -%}
        {%- assign b = block.settings -%}
        <li class="k-season k-season--{{ forloop.index }}" {{ block.shopify_attributes }}>
          <span class="k-season__icon">{% render 'icon', name: b.icon, size: 22 %}</span>
          <h3 class="k-season__title">{{ b.title | escape }}</h3>
          <p class="k-season__months">{{ b.months | escape }}</p>
          <ul class="k-season__tasks" role="list">
            {%- if b.task_1 != blank -%}<li>{% render 'icon', name: 'check', size: 14 %} {{ b.task_1 | escape }}</li>{%- endif -%}
            {%- if b.task_2 != blank -%}<li>{% render 'icon', name: 'check', size: 14 %} {{ b.task_2 | escape }}</li>{%- endif -%}
            {%- if b.task_3 != blank -%}<li>{% render 'icon', name: 'check', size: 14 %} {{ b.task_3 | escape }}</li>{%- endif -%}
          </ul>
          {%- if b.link != blank -%}<a class="k-season__link" href="{{ b.link }}" aria-label="{{ b.title | escape }}">{% render 'icon', name: 'arrow-right', size: 16 %}</a>{%- endif -%}
        </li>
      {%- endfor -%}
    </ol>
  </div>
</div>
`,
  css: `
.k-cal__list { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 0; padding: 0; list-style: none; border: 1px solid var(--v-line); border-radius: var(--arch) var(--arch) var(--round) var(--round); overflow: hidden; background: var(--v-card); }
.k-season { position: relative; padding: 34px 24px 30px; border-left: 1px solid var(--v-line); } .k-season:first-child { border-left: 0; }
.k-season::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 6px; background: var(--v-accent); } .k-season--2::before { background: #c8683f; } .k-season--3::before { background: #b8892f; } .k-season--4::before { background: #4d7c8a; }
.k-season__icon { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 14px; border-radius: 50%; background: var(--v-accent-soft); color: var(--v-accent-deep); }
.k-season__title { margin: 0; font-size: 1.4rem; } .k-season__months { margin: 2px 0 16px; font: italic 500 .98rem/1.3 var(--f-accent); color: var(--v-muted); }
.k-season__tasks { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; font-size: .94rem; } .k-season__tasks li { display: flex; gap: 8px; align-items: flex-start; } .k-season__tasks svg { margin-top: 4px; flex-shrink: 0; color: var(--v-accent); }
.k-season__link { position: absolute; right: 16px; bottom: 16px; color: var(--v-accent); }
@media (max-width: 899px) { .k-cal__list { grid-template-columns: repeat(2, minmax(0, 1fr)); } .k-season:nth-child(3) { border-left: 0; } .k-season:nth-child(n+3) { border-top: 1px solid var(--v-line); } }
@media (max-width: 559px) { .k-cal__list { grid-template-columns: 1fr; } .k-season { border-left: 0; border-top: 1px solid var(--v-line); } .k-season:first-child { border-top: 0; } }
`,
};
