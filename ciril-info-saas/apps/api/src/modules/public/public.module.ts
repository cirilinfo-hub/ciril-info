import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

@Module({ imports: [NotificationsModule], controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
