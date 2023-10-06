import Queue from 'bee-queue';
import { REDIS_HOST, REDIS_PASSWORD, REDIS_PORT } from '../keys';

export const queue = new Queue('nance', {
  prefix: 'bq',
  isWorker: true,
  redis: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    password: REDIS_PASSWORD,
    tls: { rejectUnauthorized: false }
  },
});

export const destroyQueue = async () => {
  queue.destroy();
};
