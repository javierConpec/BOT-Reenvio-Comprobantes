import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlarmaService } from './alarma.service';
import { BillingSend } from './billing-send.entity';
import { AppController } from 'src/app.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingSend]),
  ],
  controllers: [AppController],
  providers: [AlarmaService],
})
export class AlarmaModule {}