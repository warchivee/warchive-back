import { Module } from '@nestjs/common';
import { PublishWataService } from './publish-wata.service';
import { PublishWataController } from './publish-wata.controller';
import { Wata } from 'src/admin/wata/entities/wata.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeywordsModule } from 'src/admin/keywords/keywords.module';
import { CacheModule } from '@nestjs/cache-manager';
import { PublishWata } from './entities/publish-wata.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wata, PublishWata]),
    KeywordsModule,
    CacheModule.register(),
  ],
  controllers: [PublishWataController],
  providers: [PublishWataService],
})
export class PublishWataModule {}
