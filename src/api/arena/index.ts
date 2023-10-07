import Arena from 'bull-arena';
import { Router } from 'express';
import Bee from 'bee-queue';
import { connectQueue } from '../../queue/queue';

const router = Router();

const queue = connectQueue({ isWorker: false });

const arena = Arena({
  Bee,
  queues: [
    {
      name: 'nance',
      hostId: 'Queue Server 1',
      type: 'bee',
      redis: queue.settings.redis,
    }
  ]
}, { disableListen: true });

router.use('/', arena);

export default router;
