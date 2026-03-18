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
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: AuthUser;
}

export interface PiUserDTO {
  uid: string;
  username: string;
}
