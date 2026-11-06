// Countdown timer: a heading, a date and four cells that tick down; a message replaces the cells once the date has passed.
export default {
  id: 'countdown',
  name: { en: 'Countdown timer', fr: 'Compte à rebours' },
  settings: [
    { id: 'eyebrow', type: 'text', label: { en: 'Eyebrow', fr: 'Sur-titre' }, default: { en: 'Limited time', fr: 'Durée limitée' } },
    { id: 'heading', type: 'text', label: { en: 'Heading', fr: 'Titre' }, default: { en: 'The sale ends soon', fr: 'La vente se termine bientôt' } },
    { id: 'text', type: 'text', label: { en: 'Text', fr: 'Texte' }, default: { en: 'Do not miss the last days of the offer.', fr: 'Ne manquez pas les derniers jours de l’offre.' } },
    { id: 'end_date', type: 'text', label: { en: 'End date', fr: 'Date de fin' }, info: { en: 'Format: 2027-01-31T23:59 (year, month, day, T, hour and minute).', fr: 'Format : 2027-01-31T23:59 (année, mois, jour, T, heure et minute).' }, default: '2027-12-31T23:59' },
    { id: 'ended_text', type: 'text', label: { en: 'Message when the offer has ended', fr: 'Message une fois l’offre terminée' }, default: { en: 'This offer has ended.', fr: 'Cette offre est terminée.' } },
    { id: 'button_label', type: 'text', label: { en: 'Button label', fr: 'Texte du bouton' }, default: { en: 'Shop the sale', fr: 'Voir la vente' } },
    { id: 'button_link', type: 'url', label: { en: 'Button link', fr: 'Lien du bouton' } },
    { id: 'color_scheme', type: 'color_scheme', label: { en: 'Color scheme', fr: 'Palette de couleurs' }, default: 'scheme-4' },
  ],
  presets: [{ name: { en: 'Countdown timer', fr: 'Compte à rebours' } }],
  liquid: `{%- assign s = section.settings -%}
<div class="k-section k-countdown {% render 'scheme-class', scheme: s.color_scheme %}">
  <div class="page-width">
    <div class="k-countdown__inner">
      {%- if s.eyebrow != blank -%}<p class="k-eyebrow">{{ s.eyebrow | escape }}</p>{%- endif -%}
      {%- if s.heading != blank -%}<h2 class="k-section__title">{{ s.heading | escape }}</h2>{%- endif -%}
      {%- if s.text != blank -%}<p class="k-section__text">{{ s.text | escape }}</p>{%- endif -%}
      <div data-countdown data-end="{{ s.end_date | escape }}">
        <div class="k-countdown__grid" data-countdown-grid role="timer" aria-live="off">
          <div class="k-countdown__cell"><span class="k-countdown__num" data-cd="days">00</span><span class="k-countdown__label">{{ 'countdown.days' | t }}</span></div>
          <div class="k-countdown__cell"><span class="k-countdown__num" data-cd="hours">00</span><span class="k-countdown__label">{{ 'countdown.hours' | t }}</span></div>
          <div class="k-countdown__cell"><span class="k-countdown__num" data-cd="minutes">00</span><span class="k-countdown__label">{{ 'countdown.minutes' | t }}</span></div>
          <div class="k-countdown__cell"><span class="k-countdown__num" data-cd="seconds">00</span><span class="k-countdown__label">{{ 'countdown.seconds' | t }}</span></div>
        </div>
      </div>
      <p class="k-section__text" data-countdown-ended hidden>{{ s.ended_text | escape }}</p>
      {%- if s.button_label != blank -%}<a class="button" href="{{ s.button_link | default: routes.all_products_collection_url }}">{{ s.button_label | escape }}</a>{%- endif -%}
    </div>
  </div>
</div>
`,
  css: '',
};
