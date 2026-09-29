import { cn } from '@/lib/utils';

export type VatDeduction = 'full' | 'half' | 'none';

interface VatDeductionTogglesProps {
  deduction: VatDeduction;
  isPrivate: boolean;
  onDeductionChange: (value: VatDeduction) => void;
  onPrivateChange: (value: boolean) => void;
  disabled?: boolean;
  hidePassengerCar?: boolean;
  hidePrivate?: boolean;
}

export function VatDeductionToggles({
  deduction,
  isPrivate,
  onDeductionChange,
  onPrivateChange,
  disabled,
  hidePassengerCar,
  hidePrivate,
}: VatDeductionTogglesProps) {
  return (
    <div className="space-y-2">
      {!hidePrivate && (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={isPrivate}
            disabled={disabled}
            onChange={(e) => {
              onPrivateChange(e.target.checked);
              if (e.target.checked) onDeductionChange('none');
            }}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm">Zakup prywatny (bez odliczenia VAT, poza kosztami firmy)</span>
        </label>
      )}
      {!hidePassengerCar && !isPrivate && (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={deduction === 'half'}
            disabled={disabled}
            onChange={(e) => onDeductionChange(e.target.checked ? 'half' : 'full')}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm">Samochód osobowy — odlicz 50% VAT</span>
        </label>
      )}
    </div>
  );
}
