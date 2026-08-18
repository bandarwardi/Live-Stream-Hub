import { IsString, IsOptional, IsEmail, Matches, Length, NotContains } from 'class-validator';

export class CompleteProfileDto {
  @IsString()
  @Length(3, 20, { message: 'اسم المستخدم يجب أن يكون بين 3 و 20 حرفاً' })
  @Matches(/^[a-z0-9_]+$/, { message: 'اسم المستخدم يجب أن يحتوي على أحرف إنجليزية صغيرة، أرقام، وشرطة سفلية فقط' })
  @NotContains('admin', { message: 'اسم المستخدم غير متاح' })
  @NotContains('support', { message: 'اسم المستخدم غير متاح' })
  username: string;

  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
