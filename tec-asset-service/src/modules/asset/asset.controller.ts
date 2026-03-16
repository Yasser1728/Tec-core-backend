import { 
  Controller, 
  Post, 
  Body, 
  Get, 
  Param, 
  HttpCode, 
  HttpStatus, 
  NotFoundException, 
  UseInterceptors,
  ClassSerializerInterceptor
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@ApiTags('Assets')
@Controller('assets')
@UseInterceptors(ClassSerializerInterceptor) // Automatically handles data serialization
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post('provision')
  @ApiOperation({ summary: 'Provision a new asset following a successful payment' })
  @ApiResponse({ status: 201, description: 'Asset provisioned and ownership recorded.' })
  @ApiResponse({ status: 409, description: 'Conflict: Slug or Transaction ID already exists.' })
  @ApiResponse({ status: 422, description: 'Unprocessable Entity: Validation failed.' })
  @HttpCode(HttpStatus.CREATED)
  async provisionAsset(@Body() createAssetDto: CreateAssetDto) {
    const asset = await this.assetService.provisionAsset(createAssetDto);
    return { 
      message: 'Asset provisioned successfully', 
      statusCode: HttpStatus.CREATED,
      data: asset 
    };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Retrieve asset details by unique slug' })
  @ApiParam({ name: 'slug', example: 'vanguard.pi', description: 'The unique identifier of the asset' })
  @ApiResponse({ status: 200, description: 'Asset found.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async getAsset(@Param('slug') slug: string) {
    const asset = await this.assetService.findBySlug(slug);
    if (!asset) {
      throw new NotFoundException(`Asset with slug "${slug}" not found`);
    }
    return { statusCode: HttpStatus.OK, data: asset };
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'List all assets owned by a specific user' })
  @ApiParam({ name: 'userId', description: 'The UUID of the asset owner' })
  @ApiResponse({ status: 200, description: 'List of assets retrieved.' })
  async getUserAssets(@Param('userId') userId: string) {
    const assets = await this.assetService.findByUser(userId);
    return { 
      statusCode: HttpStatus.OK,
      count: assets.length, 
      data: assets 
    };
  }
}
