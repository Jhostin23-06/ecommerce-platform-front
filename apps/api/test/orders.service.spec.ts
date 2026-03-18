import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrdersService } from '../src/modules/orders/orders.service';
import {
  FulfillmentStatus,
  FulfillmentType,
  Order,
  OrderLifecycleStatus,
  OrderStatus,
} from '../src/modules/orders/order.entity';

function createOrderFixture(): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: OrderStatus.PENDING_PAYMENT,
    lifecycleStatus: OrderLifecycleStatus.PENDING,
    paymentStatus: 'unpaid',
    paymentProvider: null,
    paymentReference: null,
    couponCode: null,
    fulfillmentType: FulfillmentType.DELIVERY,
    fulfillmentStatus: FulfillmentStatus.PENDING,
    deliveryAddress: null,
    pickupDetails: null,
    deliveryZoneId: null,
    deliveryZoneName: null,
    deliveryWindow: null,
    assignedCourierName: null,
    assignedCourierPhone: null,
    fulfillmentNotes: null,
    shippingFee: '0.00',
    estimatedFulfillmentAt: null,
    subtotal: '30.00',
    discountTotal: '0.00',
    total: '30.00',
    currency: 'PEN',
    billingDetails: null,
    items: [
      {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'product-1',
        productVariantId: null,
        productName: 'Producto',
        sku: null,
        unitPrice: '10.00',
        quantity: 1,
        lineTotal: '10.00',
      },
      {
        id: 'item-2',
        orderId: 'order-1',
        productId: 'product-1',
        productVariantId: null,
        productName: 'Producto',
        sku: null,
        unitPrice: '10.00',
        quantity: 2,
        lineTotal: '20.00',
      },
    ] as any,
    statusHistory: [],
    user: null as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('OrdersService markOrderAsPaid', () => {
  function createService(order: Order, stock: number) {
    const product = {
      id: 'product-1',
      tenantId: 'tenant-1',
      categoryId: null,
      name: 'Producto',
      slug: 'producto',
      description: null,
      price: '10.00',
      stock,
      reservedStock: 3,
      sku: null,
      isActive: true,
      images: [],
      category: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const orderQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(order),
    };
    const transactionalOrdersRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(orderQueryBuilder),
      save: jest.fn().mockImplementation(async (value: Order) => value),
    };

    const productQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([product]),
    };

    const transactionalProductsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(productQueryBuilder),
      save: jest.fn().mockImplementation(async (value: any) => value),
    };
    const transactionalProductVariantsRepository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn().mockImplementation(async (value: any) => value),
      findBy: jest.fn().mockResolvedValue([]),
    };

    const orderItemsQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(order.items),
    };
    const transactionalOrderItemsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(orderItemsQueryBuilder),
    };

    const transactionalOrderStatusHistoryRepository = {
      create: jest.fn().mockImplementation((value: any) => value),
      save: jest.fn().mockImplementation(async (value: any) => value),
    };

    const manager = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity.name === 'Order') {
          return transactionalOrdersRepository;
        }
        if (entity.name === 'OrderItem') {
          return transactionalOrderItemsRepository;
        }
        if (entity.name === 'OrderStatusHistory') {
          return transactionalOrderStatusHistoryRepository;
        }
        if (entity.name === 'ProductVariant') {
          return transactionalProductVariantsRepository;
        }
        return transactionalProductsRepository;
      }),
    };

    const dataSource: Partial<DataSource> = {
      transaction: jest.fn().mockImplementation(async (callback: any) => callback(manager)),
    };
    const ordersRepository = {
      findOne: jest.fn().mockResolvedValue(order),
    };
    const billingDocumentsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const billingSettingsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    const service = new OrdersService(
      ordersRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      billingDocumentsRepository as any,
      billingSettingsRepository as any,
      dataSource as DataSource,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        isEnabled: () => false,
      } as any,
      {} as any,
    );

    return {
      service,
      product,
      transactionalProductsRepository,
    };
  }

  it('is idempotent when markOrderAsPaid is called multiple times', async () => {
    const order = createOrderFixture();
    const { service, product, transactionalProductsRepository } = createService(order, 5);

    await service.markOrderAsPaid(order.id, 'stripe', 'pi_1');
    await service.markOrderAsPaid(order.id, 'stripe', 'pi_1');

    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.paymentStatus).toBe('paid');
    expect(order.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
    expect(product.stock).toBe(2);
    expect(transactionalProductsRepository.save).toHaveBeenCalledTimes(1);
  });

  it('fails when stock is insufficient', async () => {
    const order = createOrderFixture();
    const { service } = createService(order, 2);

    await expect(service.markOrderAsPaid(order.id, 'stripe', 'pi_2')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
