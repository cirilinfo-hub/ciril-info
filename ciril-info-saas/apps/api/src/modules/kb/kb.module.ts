import { Module } from '@nestjs/common';
import { KbAdminController, KbPublicController } from './kb.controller.js';
import { KbService } from './kb.service.js';

@Module({ controllers: [KbAdminController, KbPublicController], providers: [KbService] })
export class KbModule {}
