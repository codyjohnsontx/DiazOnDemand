import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ContentController } from './content/content.controller.js';
import { ContentService } from './content/content.service.js';
import { ProgressController } from './progress/progress.controller.js';
import { ProgressService } from './progress/progress.service.js';
import { FavoritesController } from './favorites/favorites.controller.js';
import { FavoritesService } from './favorites/favorites.service.js';
import { MeController } from './me/me.controller.js';
import { MeService } from './me/me.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { BillingController } from './billing/billing.controller.js';
import { BillingService } from './billing/billing.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { WebhooksService } from './webhooks/webhooks.service.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
  controllers: [
    ContentController,
    ProgressController,
    FavoritesController,
    MeController,
    AdminController,
    BillingController,
    WebhooksController,
  ],
  providers: [
    ContentService,
    ProgressService,
    FavoritesService,
    MeService,
    AdminService,
    BillingService,
    WebhooksService,
  ],
})
export class AppModule {}
