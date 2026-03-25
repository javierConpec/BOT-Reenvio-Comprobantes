import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlarmaService } from './alarma.service';
import { BillingSend } from './billing-send.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingSend]),
  ],
  providers: [AlarmaService],
})
export class AlarmaModule {}