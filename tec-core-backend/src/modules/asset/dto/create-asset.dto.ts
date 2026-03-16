import { IsString, IsUUID, IsEnum, IsObject, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AssetCategory {
  DOMAIN = 'DOMAIN',
  REAL_ESTATE = 'REAL_ESTATE',
  DIGITAL_ASSET = 'DIGITAL_ASSET',
}

export class CreateAssetDto {
  @ApiProperty({
    description: 'Unique Transaction ID from Payment Service',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  transactionId: string;

  @ApiProperty({
    description: 'The Owner User ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    enum: AssetCategory,
    description: 'Classification of the asset',
    example: AssetCategory.DOMAIN,
  })
  @IsEnum(AssetCategory)
  category: AssetCategory;

  @ApiProperty({
    description: 'Unique identifier (slug) for the asset',
    example: 'vanguard.pi',
    minLength: 3,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(120) // حماية إضافية من الـ Long String attacks
  slug: string;

  @ApiProperty({
    description: 'Dynamic metadata for different asset types',
    example: { extension: '.pi', expiry: '2027-01-01' },
  })
  @IsObject()
  metadata: Record<string, any>;
}
