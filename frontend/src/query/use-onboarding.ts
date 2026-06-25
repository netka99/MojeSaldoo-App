import { useMutation, useQueryClient } from '@tanstack/react-query';
import { companyKeys } from './keys';
import { onboardingService } from '@/services/onboarding.service';
import type { OnboardingPayload } from '@/types/onboarding.types';

export function useCompleteOnboardingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OnboardingPayload) => onboardingService.complete(payload),
    onSuccess: () => {
      // Invalidate company modules so the sidebar re-fetches the new module state.
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}
