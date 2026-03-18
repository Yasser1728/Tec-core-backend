export interface TokenPayload {
  sub: string;
  email?: string;
  pi_uid?: string;
  pi_username?: string;
}

export interface AuthUser {
  id: string;
  email?: string;
  pi_uid?: string;
  pi_username?: string;
  created_at: Date;
}

export interface AuthResponse {
  success: boolean;
  isNewUser: boolean;
  user: {
    id: string;
    piId: string;
    piUsername: string;
    role: string;
    subscriptionPlan: string | null;
    createdAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface PiUserDTO {
  uid: string;
  username: string;
}
