'use client';
import { useState, useEffect, useCallback } from 'react';

export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type KycLevel  = 'L0' | 'L1' | 'L2';

export interface KycRecord {
  id:               string;
  user_id:          string;
  status:           KycStatus;
  level:            KycLevel;
  id_front_url:     string | null;
  id_back_url:      string | null;
  selfie_url:       string | null;
  rejection_reason: string | null;
  verified_at:      string | null;
  submitted_at:     string | null;
  created_at:       string;
}

interface UseKycReturn {
  kyc:          KycRecord | null;
  isLoading:    boolean;
  isSubmitting: boolean;
  error:        string | null;
  refetch:      () => void;
  uploadDocs:   (data: { idFrontUrl?: string; idBackUrl?: string; selfieUrl?: string }) => Promise<void>;
  submit:       () => Promise<void>;
  reset:        () => void;
}

const GATEWAY = process.env.NEXT_PUBLIC_API_GATEWAY_URL!;

export function useKyc(): UseKycReturn {
  const [kyc,          setKyc]          = useState<KycRecord | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const getToken = (): string =>
    typeof window !== 'undefined'
      ? localStorage.getItem('tec_access_token') ?? ''
      : '';

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${getToken()}`,
  });

  // ── Fetch status ──────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/api/kyc/status`, { headers: headers() });
      if (!res.ok) throw new Error(`KYC fetch failed: ${res.status}`);
      const data = await res.json();
      setKyc(data.data.kyc);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Upload docs ───────────────────────────────────────
  const uploadDocs = useCallback(async (data: {
    idFrontUrl?: string;
    idBackUrl?:  string;
    selfieUrl?:  string;
  }) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/api/kyc/upload`, {
        method:  'POST',
        headers: headers(),
        body:    JSON.stringify(data),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message ?? 'Upload failed');
      }
      const result = await res.json();
      setKyc(result.data.kyc);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  // ── Submit ────────────────────────────────────────────
  const submit = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/api/kyc/submit`, {
        method:  'POST',
        headers: headers(),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message ?? 'Submit failed');
      }
      const result = await res.json();
      setKyc(result.data.kyc);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  // ── Reset (start over after rejection) ───────────────
  const reset = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await fetch(`${GATEWAY}/api/kyc/start`, {
        method:  'POST',
        headers: headers(),
      });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [fetchStatus]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return {
    kyc, isLoading, isSubmitting, error,
    refetch: fetchStatus,
    uploadDocs, submit, reset,
  };
}
