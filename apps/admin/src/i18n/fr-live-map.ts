import type { enLiveMap } from './en-live-map';

export const frLiveMap: Record<keyof typeof enLiveMap, string> = {
  'live.map.title': 'Visiteurs par pays', 'live.map.window': '5 dernières minutes', 'live.map.aria': 'Carte du monde des visiteurs des 5 dernières minutes',
  'live.map.topCountries': 'Principaux pays', 'live.map.none': 'Aucun visiteur dont le pays est connu ces 5 dernières minutes.',
  'live.map.visitors': '{n} visiteurs', 'live.map.visitors.one': '{n} visiteur', 'live.map.unknown': 'Pays inconnu', 'live.map.loading': 'Chargement de la carte…',
  'live.map.note': 'Le pays est déduit du fuseau horaire de chaque visiteur, uniquement lorsque les statistiques sont autorisées. ShopMe ne conserve ni adresse IP ni position précise.',
};
