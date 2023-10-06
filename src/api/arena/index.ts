import Arena from 'bull-arena';
import { Router } from 'express';
import Bee from 'bee-queue';
import { queue } from '../../queue/queue';

const router = Router();

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
