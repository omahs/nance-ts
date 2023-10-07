import Queue from 'bee-queue';
import { REDIS_HOST, REDIS_PASSWORD, REDIS_PORT } from '../keys';

export interface QueueJobData {
  space: string;
  type: string;
  delayUntil: Date;
  dataDate?: Date;
}

export const connectQueue = ({ isWorker = true }) => {
  return new Queue('nance', {
    prefix: 'bq',
    isWorker,
    redis: {
      host: REDIS_HOST,
      port: Number(REDIS_PORT),
      password: REDIS_PASSWORD,
      tls: { rejectUnauthorized: false }
    },
    activateDelayedJobs: true,
  });
};
