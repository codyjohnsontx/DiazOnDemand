import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class HealthController {
  /**
   * Liveness probe. Deliberately touches nothing - no database, no third party -
   * so a transient dependency blip cannot make the platform kill a process that
   * is otherwise healthy. It also answers while the coming-soon wall is up; see
   * the allowlist in create-app.ts.
   */
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
