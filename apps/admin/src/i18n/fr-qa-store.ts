import type { enQaStore } from './en-qa-store';

export const frQaStore: Record<keyof typeof enQaStore, string> = {
  'users.title': 'Utilisateurs', 'users.addButton': 'Ajouter des utilisateurs',
  'editor.groupTemplate': 'Modèle', 'editor.draft': 'Brouillon', 'editor.panels': 'Panneaux de l’éditeur',
  'editor.page.index': 'Page d’accueil', 'editor.page.product': 'Page produit', 'editor.page.collection': 'Page de collection', 'editor.page.list-collections': 'Liste des collections',
  'editor.page.page': 'Page', 'editor.page.cart': 'Panier', 'editor.page.search': 'Recherche', 'editor.page.404': 'Page 404', 'editor.page.blog': 'Blog', 'editor.page.article': 'Article',
};
