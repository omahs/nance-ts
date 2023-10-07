import { connectQueue } from '../queue';

const queue = connectQueue({ isWorker: false });
queue.destroy();
