import { Badge } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MapPin, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { UserErrors, gql } from '../../api';
import { TRANSFER_LOCATIONS } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

export interface LocationOption { id: string; name: string; isActive: boolean }

export function useLocationOptions() {
  return useQuery({ queryKey: ['transfer-locations'], queryFn: async () => (await gql<{ locations: { nodes: LocationOption[] } }>(TRANSFER_LOCATIONS)).locations.nodes.filter((l) => l.isActive) });
}

export const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

const tone = { DRAFT: 'neutral', READY_TO_SHIP: 'attention', IN_PROGRESS: 'info', TRANSFERRED: 'success', CANCELED: 'neutral', IN_TRANSIT: 'info', PARTIALLY_RECEIVED: 'attention', RECEIVED: 'success' } as const;

export function TransferStatusBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={tone[status as keyof typeof tone] ?? 'neutral'}>{t(`transfer.status.${status}` as Key)}</Badge>;
}

/** Locale date input value (`yyyy-mm-dd`) of today or of an ISO date. */
export const dayValue = (iso?: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Origin -> in transit -> destination strip used at the top of the create form. */
export function Pipeline({ start, end, middle }: { start: ReactNode; end: ReactNode; middle?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {start}
      <ArrowRight className="size-4 text-muted" aria-hidden />
      {middle !== undefined && <><span className="flex items-center gap-1.5 text-[13px] text-muted">{middle}</span><ArrowRight className="size-4 text-muted" aria-hidden /></>}
      {end}
    </div>
  );
}

export const TransitStep = ({ label }: { label: string }) => <><Truck className="size-4" aria-hidden />{label}</>;

export function PinSelect({ value, onChange, options, placeholder, label, disabled }: { value: string; onChange: (v: string) => void; options: LocationOption[]; placeholder: string; label: string; disabled?: boolean }) {
  return (
    <label className="relative inline-flex items-center">
      <MapPin className="pointer-events-none absolute left-2.5 size-4 text-muted" aria-hidden />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="field-control h-8 max-w-[16rem] pl-8 pr-8 text-[13px] font-medium">
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
