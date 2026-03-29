import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  check() {
    // Al devolver un string simple, NestJS no gasta recursos 
    // creando un objeto JSON complejo.
    return 'OK'; 
  }
}