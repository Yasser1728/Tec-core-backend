// src/sdk/tec-auth-sdk.ts

import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env'; // التأكد من المسار الصحيح للملف

export interface LoginDto {
  email?: string;
  password?: string;
  pi_uid?: string;
  device?: string;
  ip_address?: string;
}

export interface RegisterDto {
  email: string;
  password?: string;
  pi_uid?: string;
  pi_username?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    role: string;
    pi_uid?: string;
    pi_username?: string;
  };
}

export class AuthClient {
  private http: AxiosInstance;

  // تم تغيير AUTH_BASE_URL إلى API_BASE_URL ليتطابق مع env.ts
  constructor(baseURL: string = env.API_BASE_URL) {
    this.http = axios.create({
      baseURL,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const res = await this.http.post<AuthResponse>('/auth/login', dto);
    return res.data;
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const res = await this.http.post<AuthResponse>('/auth/register', dto);
    return res.data;
  }
}
