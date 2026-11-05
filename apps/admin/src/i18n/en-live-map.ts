// Live view: visitors by country (from the browser time zone, never the IP address).
export const enLiveMap = {
  'live.map.title': 'Visitors by country', 'live.map.window': 'Last 5 minutes', 'live.map.aria': 'World map of the visitors of the last 5 minutes',
  'live.map.topCountries': 'Top countries', 'live.map.none': 'No visitor with a known country in the last 5 minutes.',
  'live.map.visitors': '{n} visitors', 'live.map.visitors.one': '{n} visitor', 'live.map.unknown': 'Country unknown', 'live.map.loading': 'Loading the map…',
  'live.map.note': 'The country comes from each visitor’s time zone, only when analytics are allowed. ShopMe stores no IP address and no precise location.',
} as const;
