// Dashboard analytics (ShopMe extension).
export const SHOPME_DASHBOARD = /* GraphQL */ `
  query ShopmeDashboard($range: String!) {
    shopmeDashboard(range: $range) {
      totalSales { amount currencyCode }
      ordersCount
      averageOrderValue { amount currencyCode }
      salesByDay { date total }
      topProducts { title quantity }
    }
  }
`;
