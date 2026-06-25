import { api } from './api';
import type { OnboardingCompleteResponse, OnboardingPayload } from '@/types/onboarding.types';

export const onboardingService = {
  complete: (payload: OnboardingPayload) =>
    api.post<OnboardingCompleteResponse>('/auth/onboarding/complete/', payload),
};
