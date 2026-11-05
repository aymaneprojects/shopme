/** The live theme, whose customer account pages Settings > Customer accounts opens in the theme editor. */
export const ACCOUNT_PAGES_THEME = /* GraphQL */ `
  query AccountPagesTheme { themes(first: 5) { nodes { id name role } } }
`;
