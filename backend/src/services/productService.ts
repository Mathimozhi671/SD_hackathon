import { AppDatabase } from '../database/db.js';
import { Product } from '../types/index.js';

export class ProductService {
  private db: AppDatabase;
  private static instance: ProductService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
  }

  public static getInstance(): ProductService {
    if (!ProductService.instance) {
      ProductService.instance = new ProductService();
    }
    return ProductService.instance;
  }

  public async getProduct(productId: string): Promise<Product | null> {
    return await this.db.getProduct(productId);
  }

  public async seedDefaultProduct(
    productId: string = 'prod_quantum_headset_2026',
    totalStock: number = 100
  ): Promise<Product> {
    const { product } = await this.db.seedProductAndInventory(
      productId,
      'SKU-QUANTUM-PRO',
      'SysCrafters 2026 Edition Quantum Pro Headset',
      299.99,
      totalStock
    );
    return product;
  }
}
