import { NestFactory } from '@nestjs/core';
import { Module, Controller, Get, Param } from '@nestjs/common';

@Controller('healthz')
class HealthController { @Get() health(){ return { ok:true, v:'v2.1'} } }

@Controller('api/scorecards')
class ScorecardsController {
  @Get(':service')
  byService(@Param('service') service: string){
    // In a real system, query DB/telemetry to compute scores.
    return {
      service,
      updatedAt: new Date().toISOString(),
      dimensions: {
        dora: 0.78, slo: 0.9, security: 0.95, cost: 0.72, policy: 1.0
      },
      grade: 'A-'
    };
  }
}

@Module({ controllers:[HealthController, ScorecardsController] })
class AppModule {}

async function bootstrap(){ const app = await NestFactory.create(AppModule); await app.listen(process.env.PORT||3000); }
bootstrap();
