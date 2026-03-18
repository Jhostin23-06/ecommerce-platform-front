#!/usr/bin/env node

const API_URL = (process.env.SEED_API_URL ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const seedConfig = {
  tenant: {
    name: process.env.SEED_TENANT_NAME ?? "Acme Demo",
    slug: process.env.SEED_TENANT_SLUG ?? "acme-demo",
  },
  adminUser: {
    email: (process.env.SEED_ADMIN_EMAIL ?? "admin@acme.com").toLowerCase(),
    password: process.env.SEED_ADMIN_PASSWORD ?? "Admin1234",
    fullName: process.env.SEED_ADMIN_NAME ?? "Admin Acme",
    role: "tenant_admin",
  },
  customerUser: {
    email: (process.env.SEED_CUSTOMER_EMAIL ?? "cliente@acme.com").toLowerCase(),
    password: process.env.SEED_CUSTOMER_PASSWORD ?? "Cliente1234",
    fullName: process.env.SEED_CUSTOMER_NAME ?? "Cliente Demo",
    role: "customer",
  },
  category: {
    name: process.env.SEED_CATEGORY_NAME ?? "Bebidas",
    slug: process.env.SEED_CATEGORY_SLUG ?? "bebidas",
    description: process.env.SEED_CATEGORY_DESCRIPTION ?? "Categoria de bebidas de prueba",
  },
  product: {
    name: process.env.SEED_PRODUCT_NAME ?? "Coca Cola 500ml",
    slug: process.env.SEED_PRODUCT_SLUG ?? "coca-cola-500ml",
    description: process.env.SEED_PRODUCT_DESCRIPTION ?? "Producto demo para pruebas del carrito",
    price: Number(process.env.SEED_PRODUCT_PRICE ?? 2.5),
    stock: Number(process.env.SEED_PRODUCT_STOCK ?? 120),
    sku: process.env.SEED_PRODUCT_SKU ?? "SKU-DEMO-001",
    imageUrl:
      process.env.SEED_PRODUCT_IMAGE_URL ??
      "https://images.unsplash.com/photo-1624517452488-04869289c4ca?auto=format&fit=crop&w=1200&q=80",
  },
  coupon: {
    code: process.env.SEED_COUPON_CODE ?? "OFF10",
    type: "percentage",
    value: Number(process.env.SEED_COUPON_VALUE ?? 10),
  },
  bootstrapToken: process.env.SEED_BOOTSTRAP_TOKEN ?? process.env.ADMIN_BOOTSTRAP_TOKEN ?? "",
};

class HttpError extends Error {
  constructor(status, path, payload) {
    const message = extractErrorMessage(payload) ?? `Request failed (${status})`;
    super(`${message} [${status}] ${path}`);
    this.status = status;
    this.path = path;
    this.payload = payload;
  }
}

function extractErrorMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeMessage = payload.message;
  if (typeof maybeMessage === "string") {
    return maybeMessage;
  }
  if (Array.isArray(maybeMessage)) {
    return maybeMessage.find((entry) => typeof entry === "string") ?? null;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    throw new HttpError(response.status, path, payload);
  }

  return payload;
}

async function waitForApi(maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await request("/health");
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `No se pudo conectar a la API en ${API_URL}. Inicia la API y vuelve a correr el seed.`,
        );
      }
      process.stdout.write(`Esperando API (${attempt}/${maxAttempts})...\n`);
      await sleep(1000);
    }
  }
}

async function ensureTenant() {
  if (!seedConfig.bootstrapToken) {
    throw new Error(
      "SEED_BOOTSTRAP_TOKEN (o ADMIN_BOOTSTRAP_TOKEN) es requerido para crear tenant en bootstrap.",
    );
  }

  const tenants = await request("/tenants");
  const existing = tenants.find((entry) => entry.slug === seedConfig.tenant.slug);
  if (existing) {
    process.stdout.write(`Tenant existente: ${existing.slug} (${existing.id})\n`);
    return existing;
  }

  const created = await request("/tenants/bootstrap", {
    method: "POST",
    body: {
      tenant: {
        name: seedConfig.tenant.name,
        slug: seedConfig.tenant.slug,
      },
      bootstrapToken: seedConfig.bootstrapToken,
    },
  });
  process.stdout.write(`Tenant creado: ${created.slug} (${created.id})\n`);
  return created;
}

async function ensureAdminUser(user, tenantId) {
  if (!seedConfig.bootstrapToken) {
    throw new Error(
      "SEED_BOOTSTRAP_TOKEN (o ADMIN_BOOTSTRAP_TOKEN) es requerido para crear usuario admin en bootstrap.",
    );
  }

  try {
    await request("/auth/register/bootstrap", {
      method: "POST",
      body: {
        register: {
          email: user.email,
          password: user.password,
          fullName: user.fullName,
          tenantId,
          role: user.role,
        },
        bootstrapToken: seedConfig.bootstrapToken,
      },
    });
    process.stdout.write(`Usuario creado: ${user.email}\n`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      process.stdout.write(`Usuario ya existe: ${user.email}\n`);
    } else {
      throw error;
    }
  }

  try {
    return await request("/auth/login", {
      method: "POST",
      body: {
        email: user.email,
        password: user.password,
      },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      throw new Error(`No se pudo iniciar sesion con ${user.email}. Revisa credenciales o token bootstrap.`);
    }
    throw error;
  }
}

async function ensureCustomerUser(user) {
  try {
    await request("/auth/register/customer", {
      method: "POST",
      body: {
        email: user.email,
        password: user.password,
        fullName: user.fullName,
      },
    });
    process.stdout.write(`Usuario creado: ${user.email}\n`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      process.stdout.write(`Usuario ya existe: ${user.email}\n`);
      return;
    }
    throw error;
  }
}

async function ensureCategory(tenantId, token) {
  const categories = await request(`/catalog/categories?tenantId=${encodeURIComponent(tenantId)}`);
  const existing = categories.find((entry) => entry.slug === seedConfig.category.slug);
  if (existing) {
    process.stdout.write(`Categoria existente: ${existing.slug}\n`);
    return existing;
  }

  const created = await request("/catalog/categories", {
    method: "POST",
    token,
    body: {
      tenantId,
      name: seedConfig.category.name,
      slug: seedConfig.category.slug,
      description: seedConfig.category.description,
      isActive: true,
    },
  });
  process.stdout.write(`Categoria creada: ${created.slug}\n`);
  return created;
}

async function ensureProduct(tenantId, categoryId, token) {
  const query = new URLSearchParams({
    tenantId,
    page: "1",
    limit: "50",
    search: seedConfig.product.slug,
    isActive: "true",
  });

  const productsResponse = await request(`/catalog/products?${query.toString()}`);
  const existing = productsResponse.items.find((entry) => entry.slug === seedConfig.product.slug);
  if (existing) {
    process.stdout.write(`Producto existente: ${existing.slug}\n`);
    return existing;
  }

  const created = await request("/catalog/products", {
    method: "POST",
    token,
    body: {
      tenantId,
      categoryId,
      name: seedConfig.product.name,
      slug: seedConfig.product.slug,
      description: seedConfig.product.description,
      price: seedConfig.product.price,
      stock: seedConfig.product.stock,
      sku: seedConfig.product.sku,
      isActive: true,
      images: [
        {
          url: seedConfig.product.imageUrl,
          altText: seedConfig.product.name,
          sortOrder: 0,
        },
      ],
    },
  });
  process.stdout.write(`Producto creado: ${created.slug}\n`);
  return created;
}

async function ensureCoupon(tenantId, token) {
  const coupons = await request(`/coupons?tenantId=${encodeURIComponent(tenantId)}`, {
    token,
  });
  const targetCode = seedConfig.coupon.code.toUpperCase();
  const existing = coupons.find((entry) => entry.code === targetCode);
  if (existing) {
    process.stdout.write(`Cupon existente: ${existing.code}\n`);
    return existing;
  }

  const created = await request("/coupons", {
    method: "POST",
    token,
    body: {
      tenantId,
      code: targetCode,
      type: seedConfig.coupon.type,
      value: seedConfig.coupon.value,
      isActive: true,
    },
  });
  process.stdout.write(`Cupon creado: ${created.code}\n`);
  return created;
}

async function run() {
  process.stdout.write(`Seed apuntando a ${API_URL}\n`);
  await waitForApi();

  const tenant = await ensureTenant();

  const adminSession = await ensureAdminUser(seedConfig.adminUser, tenant.id);
  await ensureCustomerUser(seedConfig.customerUser);

  const category = await ensureCategory(tenant.id, adminSession.accessToken);
  const product = await ensureProduct(tenant.id, category.id, adminSession.accessToken);
  const coupon = await ensureCoupon(tenant.id, adminSession.accessToken);

  process.stdout.write("\nSeed completado.\n");
  process.stdout.write(`Tenant: ${tenant.name} (${tenant.slug})\n`);
  process.stdout.write(`Admin login: ${seedConfig.adminUser.email} / ${seedConfig.adminUser.password}\n`);
  process.stdout.write(`Cliente login: ${seedConfig.customerUser.email} / ${seedConfig.customerUser.password}\n`);
  process.stdout.write(`Producto demo: ${product.name}\n`);
  process.stdout.write(`Cupon demo: ${coupon.code}\n`);
  process.stdout.write(`Admin UI: http://localhost:3000/admin/${tenant.slug}\n`);
  process.stdout.write(`Tienda UI: http://localhost:3000/tienda/${tenant.slug}\n`);
}

run().catch((error) => {
  process.stderr.write(`\nSeed fallido: ${error.message}\n`);
  if (error instanceof HttpError && error.payload) {
    process.stderr.write(`Detalle API: ${JSON.stringify(error.payload)}\n`);
  }
  process.exit(1);
});
