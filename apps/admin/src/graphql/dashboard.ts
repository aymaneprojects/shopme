// Dashboard analytics (ShopMe extension).
export const SHOPME_DASHBOARD = /* GraphQL */ `
  query ShopmeDashboard($range: ShopmeDashboardRange!) {
    shopmeDashboard(range: $range) {
      totalSales { amount currencyCode }
      ordersCount
      averageOrderValue { amount currencyCode }
      salesByDay { date sales { amount } }
      topProducts { title quantity }
    }
  }
`;

/** Home setup guide: when the live theme was installed and last saved. */
export const HOME_THEMES = /* GraphQL */ `
  query HomeThemes { themes(first: 20) { nodes { id role createdAt updatedAt } } }
`;
