/**
 * Delivery profiles, local pickup, local delivery and shipping packages (Settings > Shipping and delivery).
 * Names follow the Admin API (`deliveryProfile`, `DeliveryMethodDefinition`, `locationLocalPickupEnable`, ...); ShopMe additions are prefixed `shopme`.
 */
import { randomUUID } from 'node:crypto';
import {
  createPackage, createProfile, deletePackage, disablePickup, enablePickup, getLocalDelivery, getLocation, getOrder, getOrderDelivery, getPackage, getPickupSettings, getProfile, getVariant, listLocations, listPackages,
  loadProfiles, makeDefaultPackage, markPickedUp, markPickupReady, profileVariantIds, removeProfile, updateLocalDelivery, updatePackage, updateProfile, WEIGHT_KG,
  type ConditionInput, type ConditionRow, type GroupRow, type LocalDeliverySettings, type Location, type MethodInput, type MethodRow, type OrderDelivery, type PickupSettings, type ProfileInput, type ProfileTree, type ShippingPackage, type ZoneInput, type ZoneRow,
} from '@shopme/core';
import { parseId, parseMoney, toGid, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginateArray } from '../types/connection';
import { definePayload, DisplayableError } from '../types/errors';
import { Count, MoneyInput, MoneyV2, moneyV2 } from '../types/money';
import { Node, registerNode } from '../types/node';
import { Job, Location_, LocationConnection, ProductVariantConnection, Product_, shopOf } from '../types/catalog';
import { CountryCode, countryName, Order_ } from '../types/sales';
import { getProduct } from '@shopme/core';
import { LengthUnit, Weight, WeightInput } from './inventory';

const DECIMAL = 'Decimal' as never;
const gid = (raw: string | null | undefined, type: string): number | null => (raw ? parseId(String(raw), type) : null);
const gids = (raw: readonly string[] | null | undefined, type: string): number[] | undefined => (raw ? raw.map((r) => gid(r, type) ?? -1) : undefined);
const notFound = (what: string, field: string[] = ['id']): UserError[] => [{ field, message: `${what} does not exist` }];
const prefix = (errors: UserError[], p: string[]): UserError[] => errors.map((e) => ({ ...e, field: e.field ? [...p, ...e.field] : p }));
const GRAMS_PER = (unit: string) => (WEIGHT_KG[unit] ?? 1) * 1000;

/* ------------------------------ enums ------------------------------ */

const ConditionField = builder.enumType('DeliveryConditionField', { values: ['TOTAL_WEIGHT', 'TOTAL_PRICE'] as const });
const ConditionOperator = builder.enumType('DeliveryConditionOperator', { values: ['GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'] as const });
const PickupTime = builder.enumType('DeliveryLocalPickupTime', { values: ['ONE_HOUR', 'TWO_HOURS', 'FOUR_HOURS', 'TWENTY_FOUR_HOURS', 'TWO_TO_FOUR_DAYS', 'FIVE_OR_MORE_DAYS', 'CUSTOM'] as const });
const PickupErrorCode = builder.enumType('DeliveryLocationLocalPickupSettingsErrorCode', { values: ['ACTIVE_LOCATION_NOT_FOUND', 'CUSTOM_PICKUP_TIME_NOT_ALLOWED', 'GENERIC_ERROR'] as const });
const PackageType = builder.enumType('ShippingPackageType', { values: ['BOX', 'FLAT_RATE', 'ENVELOPE', 'SOFT_PACK'] as const });
export const DeliveryMethodType = builder.enumType('DeliveryMethodType', { values: ['SHIPPING', 'PICK_UP', 'NONE', 'RETAIL', 'LOCAL', 'PICKUP_POINT'] as const });

const PickupError = builder.objectRef<UserError>('DeliveryLocationLocalPickupSettingsError').implement({
  interfaces: [DisplayableError],
  fields: (t) => ({ code: t.field({ type: PickupErrorCode, nullable: true, resolve: (e) => (['ACTIVE_LOCATION_NOT_FOUND', 'CUSTOM_PICKUP_TIME_NOT_ALLOWED', 'GENERIC_ERROR'].includes(e.code ?? '') ? (e.code as 'GENERIC_ERROR') : null) }) }),
});

/* ------------------------------ shapes ------------------------------ */

interface ProfileShape extends ProfileTree { currency: string }
interface GroupShape { id: number; profile: ProfileShape; group: GroupRow }
interface ZoneShape { profile: ProfileShape; zone: ZoneRow }
interface CountryShape { id: number; zoneId: number; code: string | null; restOfWorld: boolean; provinceCodes: string[] }
interface MethodShape extends MethodRow { currency: string }
interface ConditionShape extends ConditionRow { currency: string }

const toProfile = async (ctx: GraphQLContext, p: ProfileTree): Promise<ProfileShape> => ({ ...p, currency: (await shopOf(ctx)).currency });

/* ------------------------------ output types ------------------------------ */

const DeliveryProvince = builder.objectRef<{ id: number; code: string }>('DeliveryProvince').implement({
  interfaces: [Node],
  fields: (t) => ({ code: t.exposeString('code'), name: t.exposeString('code'), translatedName: t.exposeString('code') }),
});
const CodeOrRow = builder.objectRef<CountryShape>('DeliveryCountryCodeOrRestOfWorld').implement({
  fields: (t) => ({ countryCode: t.field({ type: CountryCode, nullable: true, resolve: (c) => (c.code as never) ?? null }), restOfWorld: t.exposeBoolean('restOfWorld') }),
});
const DeliveryCountry = builder.objectRef<CountryShape>('DeliveryCountry').implement({
  interfaces: [Node],
  fields: (t) => ({
    code: t.field({ type: CodeOrRow, resolve: (c) => c }),
    name: t.string({ resolve: (c) => (c.restOfWorld ? 'Rest of world' : countryName(c.code) ?? c.code ?? '') }),
    translatedName: t.string({ resolve: (c) => (c.restOfWorld ? 'Rest of world' : countryName(c.code) ?? c.code ?? '') }),
    provinces: t.field({ type: [DeliveryProvince], resolve: (c) => c.provinceCodes.map((code, i) => ({ id: c.id * 1000 + i, code })) }),
  }),
});
const zoneCountries = (z: ZoneRow): CountryShape[] => z.countries.map((c) => ({ id: c.id, zoneId: z.id, code: c.countryCode, restOfWorld: c.restOfWorld, provinceCodes: c.provinceCodes }));
const DeliveryZone = builder.objectRef<ZoneRow>('DeliveryZone').implement({
  interfaces: [Node],
  fields: (t) => ({ name: t.exposeString('name'), countries: t.field({ type: [DeliveryCountry], resolve: (z) => zoneCountries(z) }) }),
});
const CountryAndZone = builder.objectRef<{ country: CountryShape; zone: string }>('DeliveryCountryAndZone').implement({
  fields: (t) => ({ country: t.field({ type: DeliveryCountry, resolve: (c) => c.country }), zone: t.exposeString('zone') }),
});

const RateDefinition = builder.objectRef<MethodShape>('DeliveryRateDefinition').implement({
  interfaces: [Node],
  fields: (t) => ({ price: t.field({ type: MoneyV2, resolve: (m) => moneyV2(m.price, m.currency) }) }),
});
const RateProvider = builder.unionType('DeliveryRateProvider', { types: [RateDefinition], resolveType: () => RateDefinition });
const ConditionCriteria = builder.unionType('DeliveryConditionCriteria', {
  types: [MoneyV2, Weight],
  resolveType: (c) => ('amount' in (c as object) ? MoneyV2 : Weight),
});
const DeliveryCondition = builder.objectRef<ConditionShape>('DeliveryCondition').implement({
  interfaces: [Node],
  fields: (t) => ({
    field: t.field({ type: ConditionField, resolve: (c) => c.field }),
    operator: t.field({ type: ConditionOperator, resolve: (c) => c.operator }),
    conditionCriteria: t.field({ type: ConditionCriteria, resolve: (c) => (c.field === 'TOTAL_WEIGHT' ? { unit: 'GRAMS', value: c.value } : moneyV2(c.value, c.currency)) as never }),
  }),
});
const DeliveryMethodDefinition = builder.objectRef<MethodShape>('DeliveryMethodDefinition').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'), description: t.exposeString('description', { nullable: true }), active: t.exposeBoolean('active'),
    methodConditions: t.field({ type: [DeliveryCondition], resolve: (m) => m.conditions.map((c) => ({ ...c, currency: m.currency })) }),
    rateProvider: t.field({ type: RateProvider, resolve: (m) => m }),
    shopmeFreeOverAmount: t.field({ type: MoneyV2, nullable: true, description: 'ShopMe: the price becomes 0 once the order subtotal reaches this amount.', resolve: (m) => (m.freeOverAmount != null ? moneyV2(m.freeOverAmount, m.currency) : null) }),
  }),
});
const MethodConnection = defineConnection('DeliveryMethodDefinition', DeliveryMethodDefinition);
const MethodCounts = builder.objectRef<{ rateDefinitionsCount: number; participantDefinitionsCount: number }>('DeliveryMethodDefinitionCounts').implement({
  fields: (t) => ({ rateDefinitionsCount: t.exposeInt('rateDefinitionsCount'), participantDefinitionsCount: t.exposeInt('participantDefinitionsCount') }),
});
const LocationGroupZone = builder.objectRef<ZoneShape>('DeliveryLocationGroupZone').implement({
  fields: (t) => ({
    zone: t.field({ type: DeliveryZone, resolve: (z) => z.zone }),
    methodDefinitionCounts: t.field({ type: MethodCounts, resolve: (z) => ({ rateDefinitionsCount: z.zone.methods.length, participantDefinitionsCount: 0 }) }),
    methodDefinitions: t.field({
      type: MethodConnection, args: { ...ConnectionArgs, eligible: t.arg.boolean(), type: t.arg.string() },
      resolve: (z, a) => paginateArray(a, z.zone.methods.map((m) => ({ ...m, currency: z.profile.currency }))),
    }),
  }),
});
const LocationGroupZoneConnection = defineConnection('DeliveryLocationGroupZone', LocationGroupZone);

const allLocations = (ctx: GraphQLContext, includeInactive: boolean) => listLocations(ctx.db, ctx.shopId, { offset: 0, limit: 250, includeInactive });
const locationsOf = async (ctx: GraphQLContext, ids: number[]): Promise<Location[]> => {
  const all = await allLocations(ctx, true);
  return all.filter((l) => ids.includes(l.id));
};
const LocationGroup = builder.objectRef<GroupShape>('DeliveryLocationGroup').implement({
  interfaces: [Node],
  fields: (t) => ({
    locations: t.field({
      type: LocationConnection, args: { ...ConnectionArgs, includeLegacy: t.arg.boolean(), includeInactive: t.arg.boolean(), query: t.arg.string() },
      resolve: async (g, a, ctx) => paginateArray(a, (await locationsOf(ctx, g.group.locationIds)).filter((l) => a.includeInactive || l.isActive)),
    }),
    locationsCount: t.field({ type: Count, nullable: true, resolve: (g) => ({ count: g.group.locationIds.length, precision: 'EXACT' as const }) }),
  }),
});
const ProfileLocationGroup = builder.objectRef<GroupShape>('DeliveryProfileLocationGroup').implement({
  fields: (t) => ({
    locationGroup: t.field({ type: LocationGroup, resolve: (g) => g }),
    locationGroupZones: t.field({
      type: LocationGroupZoneConnection, args: { ...ConnectionArgs },
      resolve: (g, a) => paginateArray(a, g.group.zones.map((zone) => ({ profile: g.profile, zone }))),
    }),
    countriesInAnyZone: t.field({ type: [CountryAndZone], resolve: (g) => g.group.zones.flatMap((z) => zoneCountries(z).map((country) => ({ country, zone: z.name }))) }),
  }),
});

interface ItemShape { id: number; productId: number; variantIds: number[] }
const ProfileItem = builder.objectRef<ItemShape>('DeliveryProfileItem').implement({
  interfaces: [Node],
  fields: (t) => ({
    product: t.field({ type: Product_, resolve: async (i, _a, ctx) => (await getProduct(ctx.db, ctx.shopId, i.productId))! }),
    variants: t.field({
      type: ProductVariantConnection, args: { ...ConnectionArgs },
      resolve: async (i, a, ctx) => paginateArray(a, (await Promise.all(i.variantIds.map((v) => getVariant(ctx.db, ctx.shopId, v)))).filter((v): v is NonNullable<typeof v> => !!v)),
    }),
  }),
});
const ProfileItemConnection = defineConnection('DeliveryProfileItem', ProfileItem);

const variantItems = async (ctx: GraphQLContext, profileId: number): Promise<ItemShape[]> => {
  const ids = await profileVariantIds(ctx.db, ctx.shopId, profileId);
  const byProduct = new Map<number, number[]>();
  for (const id of ids) {
    const v = await getVariant(ctx.db, ctx.shopId, id);
    if (v) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), id]);
  }
  return [...byProduct].map(([productId, variantIds]) => ({ id: productId, productId, variantIds }));
};

const DeliveryProfile = builder.objectRef<ProfileShape>('DeliveryProfile').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'),
    default: t.exposeBoolean('isDefault'),
    version: t.exposeInt('version'),
    createdAt: t.field({ type: 'DateTime', resolve: (p) => p.createdAt }),
    coversAllItems: t.boolean({ resolve: (p) => p.isDefault }),
    productVariantsCount: t.field({ type: Count, nullable: true, resolve: (p) => ({ count: p.variantCount, precision: 'EXACT' as const }) }),
    activeMethodDefinitionsCount: t.int({ resolve: (p) => p.groups.reduce((a, g) => a + g.zones.reduce((b, z) => b + z.methods.filter((m) => m.active).length, 0), 0) }),
    locationsWithoutRatesCount: t.int({ resolve: (p) => p.groups.filter((g) => !g.zones.some((z) => z.methods.length)).reduce((a, g) => a + g.locationIds.length, 0) }),
    originLocationCount: t.int({ resolve: (p) => new Set(p.groups.flatMap((g) => g.locationIds)).size }),
    zoneCountryCount: t.int({ resolve: (p) => new Set(p.groups.flatMap((g) => g.zones.flatMap((z) => z.countries.map((c) => c.countryCode ?? '*')))).size }),
    profileLocationGroups: t.field({
      type: [ProfileLocationGroup], args: { locationGroupId: t.arg.id() },
      resolve: (p, a) => { const want = gid(a.locationGroupId, 'DeliveryLocationGroup'); return p.groups.filter((g) => !want || g.id === want).map((group) => ({ id: group.id, profile: p, group })); },
    }),
    profileItems: t.field({
      type: ProfileItemConnection, args: { ...ConnectionArgs },
      resolve: async (p, a, ctx) => paginateArray(a, p.isDefault ? [] : await variantItems(ctx, p.id)),
    }),
    unassignedLocations: t.field({
      type: [Location_],
      resolve: async (p, _a, ctx) => { const used = new Set(p.groups.flatMap((g) => g.locationIds)); return (await allLocations(ctx, false)).filter((l) => !used.has(l.id) && l.isActive); },
    }),
  }),
});
registerNode('DeliveryProfile', async (ctx, id) => { const p = await getProfile(ctx.db, ctx.shopId, id); return p ? toProfile(ctx, p) : null; });
registerNode('DeliveryZone', async (ctx, id) => { for (const p of await loadProfiles(ctx.db, ctx.shopId)) for (const g of p.groups) { const z = g.zones.find((x) => x.id === id); if (z) return z; } return null; });
registerNode('DeliveryMethodDefinition', async (ctx, id) => {
  const currency = (await shopOf(ctx)).currency;
  for (const p of await loadProfiles(ctx.db, ctx.shopId)) for (const g of p.groups) for (const z of g.zones) { const m = z.methods.find((x) => x.id === id); if (m) return { ...m, currency }; }
  return null;
});
const DeliveryProfileConnection = defineConnection('DeliveryProfile', DeliveryProfile);

/* ------------------------------ pickup and local delivery ------------------------------ */

const LocalPickupSettings = builder.objectRef<PickupSettings>('DeliveryLocalPickupSettings').implement({
  fields: (t) => ({ instructions: t.exposeString('instructions'), pickupTime: t.field({ type: PickupTime, resolve: (s) => s.pickupTime as never }) }),
});
const LocalDelivery = builder.objectRef<LocalDeliverySettings & { currency: string }>('ShopmeLocalDeliverySettings').implement({
  fields: (t) => ({
    enabled: t.exposeBoolean('enabled'), areaType: t.exposeString('areaType'), postalCodes: t.exposeStringList('postalCodes'),
    price: t.field({ type: MoneyV2, resolve: (d) => moneyV2(d.price, d.currency) }),
    minimumOrder: t.field({ type: MoneyV2, nullable: true, resolve: (d) => (d.minimumOrder != null ? moneyV2(d.minimumOrder, d.currency) : null) }),
    freeOverAmount: t.field({ type: MoneyV2, nullable: true, resolve: (d) => (d.freeOverAmount != null ? moneyV2(d.freeOverAmount, d.currency) : null) }),
    info: t.exposeString('info', { nullable: true }), phone: t.exposeString('phone', { nullable: true }),
  }),
});

builder.objectField(Location_, 'localPickupSettingsV2', (t) => t.field({
  type: LocalPickupSettings, nullable: true, description: 'Pickup settings when local pickup is turned on at this location.',
  resolve: async (l, _a, ctx) => { const s = await getPickupSettings(ctx.db, ctx.shopId, l.id); return s?.enabled ? s : null; },
}));
builder.objectField(Location_, 'shopmeLocalDelivery', (t) => t.field({
  type: LocalDelivery, nullable: true,
  resolve: async (l, _a, ctx) => { const d = await getLocalDelivery(ctx.db, ctx.shopId, l.id); return d ? { ...d, currency: (await shopOf(ctx)).currency } : null; },
}));

/* ------------------------------ packages ------------------------------ */

const Package = builder.objectRef<ShippingPackage>('ShopmeShippingPackage').implement({
  interfaces: [Node],
  fields: (t) => ({
    name: t.exposeString('name'), type: t.field({ type: PackageType, resolve: (p) => p.type as never }), default: t.exposeBoolean('isDefault'),
    length: t.exposeFloat('length', { nullable: true }), width: t.exposeFloat('width', { nullable: true }), height: t.exposeFloat('height', { nullable: true }),
    dimensionUnit: t.field({ type: LengthUnit, resolve: (p) => p.dimensionUnit as never }),
    weight: t.field({ type: Weight, nullable: true, resolve: (p) => (p.weight != null ? { unit: p.weightUnit, value: p.weight } : null) }),
  }),
});
registerNode('ShopmeShippingPackage', async (ctx, id) => getPackage(ctx.db, ctx.shopId, id));

const DimensionsInput = builder.inputType('ObjectDimensionsInput', { fields: (t) => ({ length: t.float({ required: true }), width: t.float({ required: true }), height: t.float({ required: true }), unit: t.field({ type: LengthUnit, required: true }) }) });
const PackageInput = builder.inputType('CustomShippingPackageInput', {
  fields: (t) => ({ weight: t.field({ type: WeightInput }), dimensions: t.field({ type: DimensionsInput }), default: t.boolean({ defaultValue: false }), name: t.string(), type: t.field({ type: PackageType }) }),
});
const packageOf = (i: typeof PackageInput.$inferInput) => ({
  name: i.name, type: i.type ?? undefined, default: i.default,
  ...(i.dimensions && { length: i.dimensions.length, width: i.dimensions.width, height: i.dimensions.height, dimensionUnit: i.dimensions.unit }),
  ...(i.weight && { weight: i.weight.value, weightUnit: i.weight.unit as string }),
});

/* ------------------------------ order delivery ------------------------------ */

interface OrderDeliveryShape extends OrderDelivery { orderId: number }
const OrderDeliveryType = builder.objectRef<OrderDeliveryShape>('ShopmeOrderDelivery').implement({
  fields: (t) => ({
    methodType: t.field({ type: DeliveryMethodType, resolve: (d) => d.methodType as never }),
    location: t.field({ type: Location_, nullable: true, resolve: async (d, _a, ctx) => (d.locationId ? getLocation(ctx.db, ctx.shopId, d.locationId) : null) }),
    pickupReadyAt: t.field({ type: 'DateTime', nullable: true, resolve: (d) => d.pickupReadyAt }),
    pickedUpAt: t.field({ type: 'DateTime', nullable: true, resolve: (d) => d.pickedUpAt }),
  }),
});
builder.objectField(Order_, 'shopmeDelivery', (t) => t.field({
  type: OrderDeliveryType, nullable: true, description: 'How the order is delivered: shipping, pickup or local delivery, and the pickup progress.',
  resolve: (o, _a, ctx) => getOrderDelivery(ctx.db, ctx.shopId, o.id),
}));

/* ------------------------------ inputs ------------------------------ */

const ProvinceInput = builder.inputType('DeliveryProvinceInput', { fields: (t) => ({ code: t.string({ required: true }) }) });
const CountryInput = builder.inputType('DeliveryCountryInput', {
  fields: (t) => ({ code: t.field({ type: CountryCode }), restOfWorld: t.boolean(), provinces: t.field({ type: [ProvinceInput] }), includeAllProvinces: t.boolean() }),
});
const RateDefinitionInput = builder.inputType('DeliveryRateDefinitionInput', { fields: (t) => ({ id: t.id(), price: t.field({ type: MoneyInput, required: true }) }) });
const WeightConditionInput = builder.inputType('DeliveryWeightConditionInput', { fields: (t) => ({ criteria: t.field({ type: WeightInput }), operator: t.field({ type: ConditionOperator }) }) });
const PriceConditionInput = builder.inputType('DeliveryPriceConditionInput', { fields: (t) => ({ criteria: t.field({ type: MoneyInput }), operator: t.field({ type: ConditionOperator }) }) });
const UpdateConditionInput = builder.inputType('DeliveryUpdateConditionInput', {
  fields: (t) => ({ id: t.id({ required: true }), criteria: t.float(), criteriaUnit: t.string(), field: t.field({ type: ConditionField }), operator: t.field({ type: ConditionOperator }) }),
});
const MethodDefinitionInput = builder.inputType('DeliveryMethodDefinitionInput', {
  fields: (t) => ({
    id: t.id(), name: t.string(), description: t.string(), active: t.boolean(), rateDefinition: t.field({ type: RateDefinitionInput }),
    weightConditionsToCreate: t.field({ type: [WeightConditionInput] }), priceConditionsToCreate: t.field({ type: [PriceConditionInput] }), conditionsToUpdate: t.field({ type: [UpdateConditionInput] }),
    shopmeFreeOverAmount: t.field({ type: MoneyInput, description: 'ShopMe: free shipping once the order subtotal reaches this amount. Pass `shopmeClearFreeOver` to remove it.' }),
    shopmeClearFreeOver: t.boolean(),
  }),
});
const ZoneInputT = builder.inputType('DeliveryLocationGroupZoneInput', {
  fields: (t) => ({
    id: t.id(), name: t.string(), countries: t.field({ type: [CountryInput] }),
    methodDefinitionsToCreate: t.field({ type: [MethodDefinitionInput] }), methodDefinitionsToUpdate: t.field({ type: [MethodDefinitionInput] }),
  }),
});
const GroupInputT = builder.inputType('DeliveryProfileLocationGroupInput', {
  fields: (t) => ({
    id: t.id(), locations: t.idList(), locationsToAdd: t.idList(), locationsToRemove: t.idList(),
    zonesToCreate: t.field({ type: [ZoneInputT] }), zonesToUpdate: t.field({ type: [ZoneInputT] }),
  }),
});
const ProfileInputT = builder.inputType('DeliveryProfileInput', {
  fields: (t) => ({
    name: t.string(), profileLocationGroups: t.field({ type: [GroupInputT] }), locationGroupsToCreate: t.field({ type: [GroupInputT] }), locationGroupsToUpdate: t.field({ type: [GroupInputT] }),
    locationGroupsToDelete: t.idList(), variantsToAssociate: t.idList(), variantsToDissociate: t.idList(), zonesToDelete: t.idList(), methodDefinitionsToDelete: t.idList(), conditionsToDelete: t.idList(),
    sellingPlanGroupsToAssociate: t.idList(), sellingPlanGroupsToDissociate: t.idList(), coversAllItems: t.boolean(),
  }),
});

/** Admin API input -> service input. `existing` resolves condition ids for `conditionsToUpdate`. */
function toProfileInput(i: typeof ProfileInputT.$inferInput, currency: string, existing: Map<number, ConditionRow>): ProfileInput {
  const method = (m: typeof MethodDefinitionInput.$inferInput): MethodInput => {
    const conds: ConditionInput[] = [
      ...(m.weightConditionsToCreate ?? []).flatMap((c) => (c.criteria && c.operator ? [{ field: 'TOTAL_WEIGHT' as const, operator: c.operator, value: Math.round(c.criteria.value * GRAMS_PER(c.criteria.unit as string)) }] : [])),
      ...(m.priceConditionsToCreate ?? []).flatMap((c) => (c.criteria && c.operator ? [{ field: 'TOTAL_PRICE' as const, operator: c.operator, value: parseMoney(String(c.criteria.amount), currency) }] : [])),
    ];
    const updates = (m.conditionsToUpdate ?? []).flatMap((u) => {
      const id = gid(u.id, 'DeliveryCondition'); const cur = id ? existing.get(id) : undefined;
      if (!id || !cur) return [];
      const field = u.field ?? cur.field;
      const value = u.criteria == null ? cur.value : field === 'TOTAL_WEIGHT' ? Math.round(u.criteria * GRAMS_PER(u.criteriaUnit ?? 'GRAMS')) : parseMoney(u.criteria, currency);
      return [{ id, field, operator: u.operator ?? cur.operator, value }];
    });
    return {
      id: gid(m.id, 'DeliveryMethodDefinition'), name: m.name, description: m.description, active: m.active,
      price: m.rateDefinition ? parseMoney(String(m.rateDefinition.price.amount), currency) : undefined,
      freeOverAmount: m.shopmeFreeOverAmount ? parseMoney(String(m.shopmeFreeOverAmount.amount), currency) : undefined, clearFreeOver: m.shopmeClearFreeOver,
      conditionsToCreate: conds, conditionsToUpdate: updates,
    };
  };
  const zone = (z: typeof ZoneInputT.$inferInput): ZoneInput => ({
    id: gid(z.id, 'DeliveryLocationGroupZone') ?? gid(z.id, 'DeliveryZone'), name: z.name,
    countries: z.countries?.map((c) => ({ code: c.code, restOfWorld: c.restOfWorld, provinces: c.provinces?.map((p) => p.code) })),
    methodDefinitionsToCreate: z.methodDefinitionsToCreate?.map(method), methodDefinitionsToUpdate: z.methodDefinitionsToUpdate?.map(method),
  });
  const group = (g: typeof GroupInputT.$inferInput) => ({
    id: gid(g.id, 'DeliveryLocationGroup'), locations: gids(g.locations, 'Location'), locationsToAdd: gids(g.locationsToAdd, 'Location'), locationsToRemove: gids(g.locationsToRemove, 'Location'),
    zonesToCreate: g.zonesToCreate?.map(zone), zonesToUpdate: g.zonesToUpdate?.map(zone),
  });
  return {
    name: i.name, variantsToAssociate: gids(i.variantsToAssociate, 'ProductVariant'), variantsToDissociate: gids(i.variantsToDissociate, 'ProductVariant'),
    locationGroupsToCreate: [...(i.locationGroupsToCreate ?? []), ...(i.profileLocationGroups ?? [])].map(group), locationGroupsToUpdate: i.locationGroupsToUpdate?.map(group),
    locationGroupsToDelete: gids(i.locationGroupsToDelete, 'DeliveryLocationGroup'), zonesToDelete: gids(i.zonesToDelete, 'DeliveryZone'),
    methodDefinitionsToDelete: gids(i.methodDefinitionsToDelete, 'DeliveryMethodDefinition'), conditionsToDelete: gids(i.conditionsToDelete, 'DeliveryCondition'),
  };
}

/* ------------------------------ payloads ------------------------------ */

const ProfilePayload = (name: string) => definePayload<{ profile: ProfileShape | null }>(name, (t) => ({ profile: t.field({ type: DeliveryProfile, nullable: true, resolve: (p) => p.profile }) }));
const ProfileCreatePayload = ProfilePayload('DeliveryProfileCreatePayload');
const ProfileUpdatePayload = ProfilePayload('DeliveryProfileUpdatePayload');
const ProfileRemovePayload = definePayload<{ job: { id: string; done: boolean } | null }>('DeliveryProfileRemovePayload', (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }) }));

const PickupEnableInput = builder.inputType('DeliveryLocationLocalPickupEnableInput', {
  fields: (t) => ({ locationId: t.id({ required: true }), pickupTime: t.field({ type: PickupTime, required: true }), instructions: t.string() }),
});
const PickupEnablePayload = builder.objectRef<{ localPickupSettings: PickupSettings | null; userErrors: UserError[] }>('DeliveryLocationLocalPickupEnablePayload').implement({
  fields: (t) => ({ localPickupSettings: t.field({ type: LocalPickupSettings, nullable: true, resolve: (p) => p.localPickupSettings }), userErrors: t.field({ type: [PickupError], resolve: (p) => p.userErrors }) }),
});
const PickupDisablePayload = builder.objectRef<{ locationId: string | null; userErrors: UserError[] }>('DeliveryLocationLocalPickupDisablePayload').implement({
  fields: (t) => ({ locationId: t.id({ nullable: true, resolve: (p) => p.locationId }), userErrors: t.field({ type: [PickupError], resolve: (p) => p.userErrors }) }),
});
const PackagePayload = definePayload<{ shippingPackage: ShippingPackage | null }>('ShopmeShippingPackagePayload', (t) => ({ shippingPackage: t.field({ type: Package, nullable: true, resolve: (p) => p.shippingPackage }) }));
const PackageUpdatePayload = definePayload<object>('ShippingPackageUpdatePayload', () => ({}));
const PackageMakeDefaultPayload = definePayload<object>('ShippingPackageMakeDefaultPayload', () => ({}));
const PackageDeletePayload = definePayload<{ deletedId: string | null }>('ShippingPackageDeletePayload', (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const LocalDeliveryInput = builder.inputType('ShopmeLocationLocalDeliveryInput', {
  fields: (t) => ({
    enabled: t.boolean(), postalCodes: t.stringList(), price: t.field({ type: DECIMAL }), minimumOrder: t.field({ type: DECIMAL }), freeOverAmount: t.field({ type: DECIMAL }), info: t.string(), phone: t.string(),
  }),
});
const LocalDeliveryPayload = definePayload<{ localDelivery: (LocalDeliverySettings & { currency: string }) | null }>('ShopmeLocationLocalDeliveryUpdatePayload', (t) => ({ localDelivery: t.field({ type: LocalDelivery, nullable: true, resolve: (p) => p.localDelivery }) }));
const OrderPickupPayload = definePayload<{ order: Awaited<ReturnType<typeof getOrder>>; delivery: OrderDeliveryShape | null }>('ShopmeOrderPickupPayload', (t) => ({
  order: t.field({ type: Order_, nullable: true, resolve: (p) => p.order as never }), delivery: t.field({ type: OrderDeliveryType, nullable: true, resolve: (p) => p.delivery }),
}));

const staffId = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);

/* ------------------------------ roots ------------------------------ */

builder.queryFields((t) => ({
  deliveryProfile: t.field({
    type: DeliveryProfile, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_shipping'); const id = gid(a.id, 'DeliveryProfile'); const p = id ? await getProfile(ctx.db, ctx.shopId, id) : null; return p ? toProfile(ctx, p) : null; },
  }),
  deliveryProfiles: t.field({
    type: DeliveryProfileConnection, args: { ...ConnectionArgs, merchantOwnedOnly: t.arg.boolean() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_shipping'); return paginateArray(a, await Promise.all((await loadProfiles(ctx.db, ctx.shopId)).map((p) => toProfile(ctx, p)))); },
  }),
  locationsAvailableForDeliveryProfilesConnection: t.field({
    type: LocationConnection, args: { ...ConnectionArgs },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_shipping'); return paginateArray(a, (await allLocations(ctx, false)).filter((l) => l.isActive)); },
  }),
  shopmeShippingPackages: t.field({ type: [Package], resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_shipping'); return listPackages(ctx.db, ctx.shopId); } }),
}));

builder.mutationFields((t) => ({
  deliveryProfileCreate: t.field({
    type: ProfileCreatePayload, args: { profile: t.arg({ type: ProfileInputT, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const currency = (await shopOf(ctx)).currency;
      let input: ProfileInput;
      try { input = toProfileInput(a.profile, currency, new Map()); } catch { return { profile: null, userErrors: [{ field: ['profile'], message: 'Invalid input' }] }; }
      const r = await createProfile(ctx.db, ctx.shopId, input);
      return r.ok ? { profile: await toProfile(ctx, r.value), userErrors: [] } : { profile: null, userErrors: prefix(r.errors, ['profile']) };
    },
  }),
  deliveryProfileUpdate: t.field({
    type: ProfileUpdatePayload, args: { id: t.arg.id({ required: true }), profile: t.arg({ type: ProfileInputT, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.id, 'DeliveryProfile');
      const cur = id ? await getProfile(ctx.db, ctx.shopId, id) : null;
      if (!id || !cur) return { profile: null, userErrors: notFound('Profile') };
      const existing = new Map(cur.groups.flatMap((g) => g.zones.flatMap((z) => z.methods.flatMap((m) => m.conditions))).map((c) => [c.id, c]));
      const currency = (await shopOf(ctx)).currency;
      let input: ProfileInput;
      try { input = toProfileInput(a.profile, currency, existing); } catch { return { profile: null, userErrors: [{ field: ['profile'], message: 'Invalid input' }] }; }
      const r = await updateProfile(ctx.db, ctx.shopId, id, input);
      return r.ok ? { profile: await toProfile(ctx, r.value), userErrors: [] } : { profile: null, userErrors: prefix(r.errors, ['profile']) };
    },
  }),
  deliveryProfileRemove: t.field({
    type: ProfileRemovePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.id, 'DeliveryProfile');
      const r = id ? await removeProfile(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { job: { id: toGid('Job', randomUUID()), done: true }, userErrors: [] } : { job: null, userErrors: r && !r.ok ? r.errors : notFound('Profile') };
    },
  }),

  locationLocalPickupEnable: t.field({
    type: PickupEnablePayload, args: { localPickupSettings: t.arg({ type: PickupEnableInput, required: true }) },
    resolve: async (_r, { localPickupSettings: i }, ctx) => {
      requireScope(ctx, 'write_shipping');
      const locationId = gid(i.locationId, 'Location');
      if (!locationId) return { localPickupSettings: null, userErrors: [{ field: ['localPickupSettings', 'locationId'], message: 'Active location not found', code: 'ACTIVE_LOCATION_NOT_FOUND' }] };
      const r = await enablePickup(ctx.db, ctx.shopId, { locationId, pickupTime: i.pickupTime, instructions: i.instructions });
      return r.ok ? { localPickupSettings: r.value, userErrors: [] } : { localPickupSettings: null, userErrors: r.errors };
    },
  }),
  locationLocalPickupDisable: t.field({
    type: PickupDisablePayload, args: { locationId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.locationId, 'Location');
      const r = id ? await disablePickup(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { locationId: toGid('Location', id!), userErrors: [] } : { locationId: null, userErrors: r && !r.ok ? r.errors : [{ field: ['locationId'], message: 'Location not found', code: 'ACTIVE_LOCATION_NOT_FOUND' }] };
    },
  }),
  shopmeLocationLocalDeliveryUpdate: t.field({
    type: LocalDeliveryPayload, args: { locationId: t.arg.id({ required: true }), input: t.arg({ type: LocalDeliveryInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.locationId, 'Location');
      if (!id) return { localDelivery: null, userErrors: notFound('Location', ['locationId']) };
      const currency = (await shopOf(ctx)).currency;
      const money = (v: unknown) => (v === undefined ? undefined : v === null ? null : parseMoney(String(v), currency));
      const r = await updateLocalDelivery(ctx.db, ctx.shopId, id, {
        enabled: a.input.enabled, postalCodes: a.input.postalCodes, price: money(a.input.price) ?? undefined, minimumOrder: money(a.input.minimumOrder), freeOverAmount: money(a.input.freeOverAmount), info: a.input.info, phone: a.input.phone,
      });
      return r.ok ? { localDelivery: { ...r.value, currency }, userErrors: [] } : { localDelivery: null, userErrors: prefix(r.errors, ['input']) };
    },
  }),

  shopmeShippingPackageCreate: t.field({
    type: PackagePayload, args: { shippingPackage: t.arg({ type: PackageInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const r = await createPackage(ctx.db, ctx.shopId, packageOf(a.shippingPackage));
      return r.ok ? { shippingPackage: r.value, userErrors: [] } : { shippingPackage: null, userErrors: prefix(r.errors, ['shippingPackage']) };
    },
  }),
  shippingPackageUpdate: t.field({
    type: PackageUpdatePayload, args: { id: t.arg.id({ required: true }), shippingPackage: t.arg({ type: PackageInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.id, 'ShopmeShippingPackage') ?? gid(a.id, 'ShippingPackage');
      if (!id) return { userErrors: notFound('Shipping package') };
      const r = await updatePackage(ctx.db, ctx.shopId, id, packageOf(a.shippingPackage));
      return { userErrors: r.ok ? [] : prefix(r.errors, ['shippingPackage']) };
    },
  }),
  shippingPackageMakeDefault: t.field({
    type: PackageMakeDefaultPayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.id, 'ShopmeShippingPackage') ?? gid(a.id, 'ShippingPackage');
      const r = id ? await makeDefaultPackage(ctx.db, ctx.shopId, id) : null;
      return { userErrors: r?.ok ? [] : r ? r.errors : notFound('Shipping package') };
    },
  }),
  shippingPackageDelete: t.field({
    type: PackageDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_shipping');
      const id = gid(a.id, 'ShopmeShippingPackage') ?? gid(a.id, 'ShippingPackage');
      const r = id ? await deletePackage(ctx.db, ctx.shopId, id) : null;
      return r?.ok ? { deletedId: toGid('ShopmeShippingPackage', id!), userErrors: [] } : { deletedId: null, userErrors: r ? r.errors : notFound('Shipping package') };
    },
  }),

  shopmeOrderPickupMarkReady: t.field({
    type: OrderPickupPayload, args: { orderId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const id = gid(a.orderId, 'Order');
      const r = id ? await markPickupReady(ctx.db, ctx.shopId, id, staffId(ctx)) : null;
      return r?.ok ? { order: await getOrder(ctx.db, ctx.shopId, id!), delivery: r.value, userErrors: [] } : { order: null, delivery: null, userErrors: r ? prefix(r.errors, []) : notFound('Order', ['orderId']) };
    },
  }),
  shopmeOrderPickupMarkPickedUp: t.field({
    type: OrderPickupPayload, args: { orderId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_orders');
      const id = gid(a.orderId, 'Order');
      const r = id ? await markPickedUp(ctx.db, ctx.shopId, id, staffId(ctx)) : null;
      return r?.ok ? { order: await getOrder(ctx.db, ctx.shopId, id!), delivery: r.value, userErrors: [] } : { order: null, delivery: null, userErrors: r ? prefix(r.errors, []) : notFound('Order', ['orderId']) };
    },
  }),
}));
