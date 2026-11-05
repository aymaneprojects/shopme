import type { enDiscountCodes } from './en-discount-codes';

export const frDiscountCodes: Record<keyof typeof enDiscountCodes, string> = {
  'discountCodes.title': 'Codes', 'discountCodes.count': '{n} codes', 'discountCodes.count.one': '{n} code',
  'discountCodes.generate': 'Générer des codes', 'discountCodes.export': 'Exporter les codes', 'discountCodes.help': 'Les clients peuvent utiliser n’importe lequel des codes. Chaque code est suivi séparément.',
  'discountCodes.dialogTitle': 'Générer des codes de réduction', 'discountCodes.number': 'Nombre de codes', 'discountCodes.length': 'Longueur de la partie aléatoire', 'discountCodes.prefix': 'Préfixe', 'discountCodes.suffix': 'Suffixe',
  'discountCodes.prefixHelp': 'Lettres, chiffres, tirets et tirets bas.', 'discountCodes.characters': 'Caractères',
  'discountCodes.chars.ALPHANUMERIC': 'Lettres et chiffres', 'discountCodes.chars.LETTERS': 'Lettres uniquement', 'discountCodes.chars.DIGITS': 'Chiffres uniquement', 'discountCodes.chars.UNAMBIGUOUS': 'Faciles à lire (sans 0, O, 1, I, L)',
  'discountCodes.example': 'Exemple : {code}', 'discountCodes.run': 'Générer', 'discountCodes.generated': '{n} codes générés', 'discountCodes.generated.one': '{n} code généré',
  'discountCodes.exportFailed': 'Impossible d’exporter les codes.',
};
