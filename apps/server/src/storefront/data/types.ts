/** Plain objects handed to Liquid. Money is integer minor units, as themes expect. */
export interface Image {
  id: number; src: string; url: string; alt: string | null; width: number | null; height: number | null; aspect_ratio: number | null; position: number; product_id: number; media_type: string;
  preview_image: { src: string; width: number | null; height: number | null; aspect_ratio: number | null; alt: string | null };
}

export interface VariantObject {
  id: number; title: string; public_title: string | null; name: string;
  option1: string | null; option2: string | null; option3: string | null; options: string[];
  sku: string; barcode: string; price: number; compare_at_price: number | null;
  available: boolean; inventory_quantity: number; inventory_management: string | null; inventory_policy: string;
  requires_shipping: boolean; taxable: boolean; weight: number; weight_unit: string;
  featured_image: Image | null; featured_media: Image | null; image: Image | null; url: string; position: number; product_id: number;
  quantity_rule: { min: number; max: number | null; increment: number }; quantity_price_breaks: unknown[]; selling_plan_allocations: unknown[]; requires_selling_plan: boolean;
  unit_price_measurement: null; unit_price: null; metafields: Record<string, unknown>; created_at: string | null; updated_at: string | null;
}

export interface ProductObject {
  id: number; title: string; handle: string; description: string; content: string; vendor: string; type: string; product_type: string; tags: string[]; url: string;
  available: boolean; price: number; price_min: number; price_max: number; price_varies: boolean;
  compare_at_price: number | null; compare_at_price_min: number; compare_at_price_max: number; compare_at_price_varies: boolean;
  featured_image: Image | null; featured_media: Image | null; images: Image[]; media: Image[]; variants: VariantObject[];
  options: string[]; options_with_values: { name: string; position: number; values: string[]; selected_value: string | null }[];
  has_only_default_variant: boolean; selected_variant: VariantObject | null; first_available_variant: VariantObject | null; selected_or_first_available_variant: VariantObject | null;
  template_suffix: string; gift_card: boolean; 'gift_card?': boolean; requires_selling_plan: boolean; selling_plan_groups: unknown[]; metafields: Record<string, unknown>;
  published_at: string | null; created_at: string | null; updated_at: string | null; seo: { title: string | null; description: string | null };
}
