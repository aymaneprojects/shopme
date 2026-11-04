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
