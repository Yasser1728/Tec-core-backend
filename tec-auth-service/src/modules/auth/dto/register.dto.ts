// src/modules/auth/dto/register.dto.ts

export class RegisterDto {
  email?: string;
  password?: string;
  pi_uid?: string;      // هذا الحقل ضروري لحل خطأ Property 'pi_uid' does not exist
  pi_username?: string; // وهذا أيضاً
}
