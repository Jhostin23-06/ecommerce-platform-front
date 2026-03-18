import { IsUUID } from 'class-validator';

export class ToggleWishlistItemDto {
  @IsUUID()
  tenantId!: string;
}
