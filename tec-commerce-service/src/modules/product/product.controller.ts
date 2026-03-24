import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ProductService } from './product.service';

@Controller('commerce/products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly jwtService: JwtService,
  ) {}

  private getUserId(authorization: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.verify(token) as any;
      return decoded.sub ?? decoded.id;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // GET /commerce/products
  @Get()
  async findAll(
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const products = await this.productService.findAll({
      category,
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
    });
    return { success: true, data: { products } };
  }

  // GET /commerce/products/:id
  @Get(':id')
  async findById(@Param('id') id: string) {
    const product = await this.productService.findById(id);
    return { success: true, data: { product } };
  }

  // POST /commerce/products
  @Post()
  async create(
    @Headers('authorization') auth: string,
    @Body() body: {
      title: string;
      description?: string;
      price: number;
      imageUrl?: string;
      stock: number;
      category?: string;
    },
  ) {
    const sellerId = this.getUserId(auth);
    const product = await this.productService.create({
      sellerId,
      ...body,
    });
    return { success: true, data: { product } };
  }

  // PATCH /commerce/products/:id
  @Patch(':id')
  async update(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const sellerId = this.getUserId(auth);
    const product = await this.productService.update(id, sellerId, body);
    return { success: true, data: { product } };
  }

  // DELETE /commerce/products/:id
  @Delete(':id')
  async delete(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const sellerId = this.getUserId(auth);
    await this.productService.delete(id, sellerId);
    return { success: true };
  }
}
