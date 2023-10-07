import { DoltSysHandler } from '../dolt/doltSysHandler';
import { pools } from '../dolt/pools';

export const doltSys = new DoltSysHandler(pools.nance_sys);
