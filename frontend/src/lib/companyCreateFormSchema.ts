import { z } from 'zod';
import { validateNipChecksum } from '@/components/features/CustomerForm';

/** Same fields as onboarding step 1 — used when POST /api/companies/ creates a new org. */
export const companyCreateFormSchema = z.object({
  name: z
    .string()
    .refine((s) => s.trim().length > 0, { message: 'Nazwa firmy jest wymagana' })
    .transform((s) => s.trim()),
  nip: z
    .string()
    .refine((s) => s.trim().length > 0, { message: 'NIP jest wymagany' })
    .transform((s) => s.trim())
    .refine(validateNipChecksum, { message: 'Nieprawidłowy numer NIP' }),
  city: z
    .string()
    .refine((s) => s.trim().length > 0, { message: 'Miasto jest wymagane' })
    .transform((s) => s.trim()),
  address: z
    .string()
    .transform((s) => s.trim() || undefined)
    .optional(),
  phone: z
    .string()
    .transform((s) => s.trim() || undefined)
    .refine(
      (s) => {
        if (s === undefined) return true;
        const d = s.replace(/\D/g, '');
        return d.length >= 9 && d.length <= 15;
      },
      { message: 'Podaj 9–15 cyfr lub zostaw puste' },
    ),
  email: z
    .string()
    .transform((s) => s.trim() || undefined)
    .refine(
      (s) => s === undefined || z.string().email().safeParse(s).success,
      { message: 'Nieprawidłowy adres e-mail' },
    ),
});

export type CompanyCreateFormValues = z.infer<typeof companyCreateFormSchema>;
