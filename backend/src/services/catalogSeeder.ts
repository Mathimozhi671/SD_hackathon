import { v4 as uuidv4 } from 'uuid';
import { AppDatabase } from '../database/db.js';
import { getRedisClient } from '../redis/client.js';

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
}

const CATEGORIES = ['Electronics', 'Gaming', 'Audio', 'Smartphones', 'Laptops', 'Peripherals', 'Wearables', 'Cameras'];

const PRODUCT_TEMPLATES: { prefix: string; category: string; priceRange: [number, number]; stock: number }[] = [
  { prefix: 'Quantum Pro Headset',      category: 'Audio',       priceRange: [199, 499], stock: 50  },
  { prefix: 'NovaBlade Gaming Mouse',   category: 'Gaming',      priceRange: [49, 129],  stock: 200 },
  { prefix: 'HyperX Mechanical KB',     category: 'Peripherals', priceRange: [89, 229],  stock: 150 },
  { prefix: 'UltraPixel 4K Monitor',    category: 'Electronics', priceRange: [399, 899], stock: 30  },
  { prefix: 'SysCrafters Laptop Pro',   category: 'Laptops',     priceRange: [799, 1999],stock: 20  },
  { prefix: 'OmniCam 108MP',            category: 'Cameras',     priceRange: [299, 799], stock: 40  },
  { prefix: 'SwiftPhone X',             category: 'Smartphones', priceRange: [499, 1299],stock: 60  },
  { prefix: 'AirBand Pro Watch',        category: 'Wearables',   priceRange: [149, 399], stock: 80  },
  { prefix: 'VortexPad Controller',     category: 'Gaming',      priceRange: [59, 149],  stock: 120 },
  { prefix: 'ClearSound Earbuds',       category: 'Audio',       priceRange: [79, 199],  stock: 100 },
];

export class CatalogSeeder {
  private db: AppDatabase;
  private redis = getRedisClient();
  private static instance: CatalogSeeder | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
  }

  public static getInstance(): CatalogSeeder {
    if (!CatalogSeeder.instance) {
      CatalogSeeder.instance = new CatalogSeeder();
    }
    return CatalogSeeder.instance;
  }

  /**
   * Seeds N products across categories in PostgreSQL and initializes
   * their individual stock counters in Redis.
   */
  public async seedCatalog(totalProducts: number = 1000): Promise<CatalogProduct[]> {
    const catalog: CatalogProduct[] = [];
    const batchSize = 50;

    console.log(`[Catalog] Seeding ${totalProducts} products into PostgreSQL...`);

    // Clear existing catalog products
    await this.db.clearCatalogData();

    for (let i = 1; i <= totalProducts; i++) {
      const template = PRODUCT_TEMPLATES[(i - 1) % PRODUCT_TEMPLATES.length];
      const variantNum = Math.ceil(i / PRODUCT_TEMPLATES.length);
      const price = Math.round(
        (template.priceRange[0] + Math.random() * (template.priceRange[1] - template.priceRange[0])) * 100
      ) / 100;
      const stock = template.stock + Math.floor(Math.random() * 50);

      catalog.push({
        id: `catalog_prod_${String(i).padStart(5, '0')}`,
        sku: `SKU-${template.category.toUpperCase().substring(0, 4)}-${String(i).padStart(6, '0')}`,
        name: `${template.prefix} v${variantNum}`,
        category: template.category,
        price,
        stock,
      });
    }

    const CATEGORY_IMAGES: Record<string, string[]> = {
      Audio: [
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=600&q=80',
      ],
      Gaming: [
        'https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1612287233211-e408ec25f57c?auto=format&fit=crop&w=600&q=80',
      ],
      Peripherals: [
        'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?auto=format&fit=crop&w=600&q=80',
      ],
      Electronics: [
        'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=600&q=80',
      ],
      Laptops: [
        'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1603302576837-37561b2e2302?auto=format&fit=crop&w=600&q=80',
      ],
      Smartphones: [
        'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=600&q=80',
      ],
      Wearables: [
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=600&q=80',
      ],
      Cameras: [
        'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=600&q=80',
      ],
    };

    // Batch insert products
    for (let i = 0; i < catalog.length; i += batchSize) {
      const batch = catalog.slice(i, i + batchSize);
      const productsData = batch.map((p, idx) => {
        const imgs = CATEGORY_IMAGES[p.category] || CATEGORY_IMAGES.Electronics;
        const imgUrl = imgs[(i + idx) % imgs.length];
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          description: `High performance ${p.category} product - Limited Edition 2026`,
          price: p.price,
          category: p.category,
          imageUrl: imgUrl,
        };
      });

      const inventoriesData = batch.map(p => ({
        id: `inv_${p.id}`,
        productId: p.id,
        totalStock: p.stock,
        availableStock: p.stock,
        reservedStock: 0,
        version: 1,
      }));

      await this.db.seedCatalogBatch(productsData, inventoriesData);

      // Initialize Redis stock counters for each product
      for (const p of batch) {
        await this.redis.setStock(p.id, p.stock);
      }
    }

    console.log(`[Catalog] ✓ Seeded ${totalProducts} products across ${CATEGORIES.length} categories.`);
    return catalog;
  }

  public async getProductsByCategory(category: string, limit: number = 60, offset: number = 0): Promise<any[]> {
    return await this.db.getProductsByCategory(category, limit, offset);
  }

  public async getCatalogSummary(): Promise<{
    totalProducts: number;
    totalStock: number;
    byCategory: Record<string, { count: number; stock: number }>;
  }> {
    return await this.db.getCatalogSummary();
  }

  public async searchProducts(query: string = '', category?: string, limit: number = 60, offset: number = 0): Promise<{ products: any[]; total: number }> {
    return await this.db.searchCatalogProducts(query, category, limit, offset);
  }

  public async syncAllInventoriesToRedis(): Promise<number> {
    const inventories = await this.db.getAllInventories();
    for (const inv of inventories) {
      await this.redis.setStock(inv.productId, inv.availableStock);
    }
    console.log(`[Catalog] ✓ Synced ${inventories.length} product inventories into Redis.`);
    return inventories.length;
  }
}
