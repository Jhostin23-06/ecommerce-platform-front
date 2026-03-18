import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JobsQueueService } from './jobs-queue.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [JobsQueueService],
  exports: [JobsQueueService],
})
export class QueueModule {}
