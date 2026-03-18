import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { OrderLifecycleStatus } from '../../orders/order.entity';

export class ProcessBillingIssueOrderDocumentJobDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  trigger?: string;
}

export class ProcessBillingIssueCreditNoteJobDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  orderId!: string;

  @IsUUID()
  refundId!: string;

  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @MaxLength(3)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  trigger?: string;
}

export class ProcessOrderPaidEmailJobDto {
  @IsUUID()
  orderId!: string;
}

export class ProcessOrderStatusChangedEmailJobDto {
  @IsUUID()
  orderId!: string;

  @IsIn([
    OrderLifecycleStatus.PENDING,
    OrderLifecycleStatus.PAID,
    OrderLifecycleStatus.PREPARING,
    OrderLifecycleStatus.SHIPPED,
    OrderLifecycleStatus.DELIVERED,
    OrderLifecycleStatus.CANCELLED,
  ])
  previousStatus!: OrderLifecycleStatus;

  @IsIn([
    OrderLifecycleStatus.PENDING,
    OrderLifecycleStatus.PAID,
    OrderLifecycleStatus.PREPARING,
    OrderLifecycleStatus.SHIPPED,
    OrderLifecycleStatus.DELIVERED,
    OrderLifecycleStatus.CANCELLED,
  ])
  nextStatus!: OrderLifecycleStatus;
}
